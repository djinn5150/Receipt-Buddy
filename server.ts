import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import { createClient } from "@libsql/client";
import { GoogleGenAI, Type, Schema } from "@google/genai";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const upload = multer({ dest: "uploads/" });
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

if (!fs.existsSync("data")) {
  fs.mkdirSync("data");
}

// Initialize SQLite database (local file)
const db = createClient({
  url: "file:data/local.db",
});

// Setup database tables
async function setupDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storeName TEXT,
      date TEXT,
      total REAL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await db.execute(`
    CREATE TABLE IF NOT EXISTS receipt_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receiptId INTEGER,
      name TEXT,
      category TEXT,
      price REAL,
      quantity REAL,
      upc TEXT,
      grocy_synced INTEGER DEFAULT 0,
      FOREIGN KEY(receiptId) REFERENCES receipts(id)
    )
  `);

  try { await db.execute("ALTER TABLE receipt_items ADD COLUMN upc TEXT"); } catch (e) {}
  try { await db.execute("ALTER TABLE receipt_items ADD COLUMN grocy_synced INTEGER DEFAULT 0"); } catch (e) {}
  try { await db.execute("ALTER TABLE receipt_items ADD COLUMN ignored INTEGER DEFAULT 0"); } catch (e) {}

  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
}

setupDb().catch(console.error);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Fetch Settings Helper
  const getSettings = async () => {
    const result = await db.execute("SELECT * FROM settings");
    return result.rows.reduce((acc: any, row: any) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
  };

  const getGrocyBaseUrl = (url: string) => {
    let base = url.replace(/\/+$/, "");
    if (base.endsWith("/api")) {
      base = base.slice(0, -4);
    }
    return base;
  };

  app.use(express.json());

  // GET Settings
  app.get("/api/settings", async (req, res) => {
    try {
      const result = await db.execute("SELECT * FROM settings");
      const settings = result.rows.reduce((acc: any, row: any) => {
        acc[row.key] = row.value;
        return acc;
      }, {});
      res.json(settings);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  // POST Settings
  app.post("/api/settings", async (req, res) => {
    try {
      const { 
        grocyUrl, 
        grocyApiKey, 
        hermesWebhookUrl,
        visionProvider,
        fallbackProvider,
        customVisionUrl,
        customVisionApiKey,
        customVisionModel
      } = req.body;
      
      const settingsToSave = { 
        grocyUrl, 
        grocyApiKey, 
        hermesWebhookUrl,
        visionProvider,
        fallbackProvider,
        customVisionUrl,
        customVisionApiKey,
        customVisionModel 
      };
      
      for (const [key, value] of Object.entries(settingsToSave)) {
        if (value !== undefined) {
          await db.execute({
            sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
            args: [key, value as string, value as string]
          });
        }
      }
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  // GET Receipts
  app.get("/api/receipts", async (req, res) => {
    try {
      const result = await db.execute("SELECT * FROM receipts ORDER BY createdAt DESC");
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch receipts" });
    }
  });

  // GET Receipt Items (for budget)
  app.get("/api/items", async (req, res) => {
    try {
      const result = await db.execute("SELECT i.*, r.date as receiptDate FROM receipt_items i JOIN receipts r ON i.receiptId = r.id ORDER BY r.date DESC");
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch items" });
    }
  });

  // GET System Status (Check connections)
  app.get("/api/status", async (req, res) => {
    try {
      const settings = await getSettings();
      const status: any = {
        grocy: { status: "unconfigured" },
        vision: { status: "unconfigured" }
      };

      // Check Grocy
      if (settings.grocyUrl && settings.grocyApiKey) {
        const baseUrl = getGrocyBaseUrl(settings.grocyUrl);
        try {
          const grocyRes = await fetch(`${baseUrl}/api/system/info`, {
            headers: { 'GROCY-API-KEY': settings.grocyApiKey }
          });
          if (grocyRes.ok) {
            status.grocy = { status: "ok" };
          } else {
            status.grocy = { status: "error", error: `HTTP ${grocyRes.status}` };
          }
        } catch (e: any) {
          status.grocy = { status: "error", error: e.message };
        }
      }

      // Check Vision
      if (settings.visionProvider === "custom") {
        if (settings.customVisionUrl && settings.customVisionApiKey) {
          const baseUrl = settings.customVisionUrl.replace(/\/+$/, "");
          try {
            // A simple request to /models to check API key validity
            const visionRes = await fetch(`${baseUrl}/models`, {
              headers: { 'Authorization': `Bearer ${settings.customVisionApiKey}` }
            });
            if (visionRes.ok) {
              status.vision = { status: "ok" };
            } else {
              status.vision = { status: "error", error: `HTTP ${visionRes.status}` };
            }
          } catch (e: any) {
            status.vision = { status: "error", error: e.message };
          }
        } else {
          status.vision = { status: "error", error: "Custom provider selected but missing URL/Key" };
        }
      } else {
        // Gemini - default
        if (process.env.GEMINI_API_KEY) {
          status.vision = { status: "ok" };
        } else {
          status.vision = { status: "error", error: "Missing GEMINI_API_KEY env variable" };
        }
      }

      res.json(status);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to check status" });
    }
  });

  // POST Receipt Upload & Parse
  app.post("/api/upload", upload.single("receipt"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileData = fs.readFileSync(req.file.path);
      const mimeType = req.file.mimetype;

      const settings = await getSettings();
      const { 
        visionProvider = 'gemini', 
        fallbackProvider = 'none',
        customVisionUrl,
        customVisionApiKey,
        customVisionModel = 'gpt-4o-mini'
      } = settings;

      const runModel = async (provider: string) => {
        if (provider === 'gemini') {
          const response = await ai.models.generateContent({
            model: "gemini-2.5-pro",
            contents: [
              {
                role: "user",
                parts: [
                  { inlineData: { data: fileData.toString("base64"), mimeType } },
                  { text: "Parse this receipt. Extract the store name, date (YYYY-MM-DD), and total amount. Also extract a list of line items including name, price, quantity, a budget category (e.g. Groceries, Electronics, Home, Dining, etc), and the UPC/Barcode if visible. Pay extra attention to any numbers that look like barcodes, product codes, or article numbers, and extract them as 'upc'." }
                ]
              }
            ],
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  storeName: { type: Type.STRING },
                  date: { type: Type.STRING },
                  total: { type: Type.NUMBER },
                  items: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        name: { type: Type.STRING },
                        price: { type: Type.NUMBER },
                        quantity: { type: Type.NUMBER },
                        category: { type: Type.STRING },
                        upc: { type: Type.STRING }
                      },
                      required: ["name", "price", "quantity", "category"]
                    }
                  }
                },
                required: ["storeName", "date", "total", "items"]
              }
            }
          });
          if (!response.text) throw new Error("No text in response");
          return JSON.parse(response.text);
        } else if (provider === 'custom') {
          if (!customVisionUrl || !customVisionApiKey) throw new Error("Custom Vision API settings missing");
          const response = await fetch(`${customVisionUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${customVisionApiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: customVisionModel,
              response_format: { type: "json_object" },
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: "Parse this receipt into JSON matching this exact schema: { storeName: string, date: 'YYYY-MM-DD', total: number, items: [{ name: string, price: number, quantity: number, category: string, upc?: string }] }. Pay extra attention to any numbers that look like barcodes, product codes, or article numbers, and extract them as 'upc'." },
                    { type: "image_url", image_url: { url: `data:${mimeType};base64,${fileData.toString('base64')}` } }
                  ]
                }
              ]
            })
          });
          if (!response.ok) throw new Error(`Custom API Error: ${await response.text()}`);
          const data = await response.json();
          return JSON.parse(data.choices[0].message.content);
        }
        throw new Error(`Unknown provider ${provider}`);
      };

      let parsedData;
      try {
        parsedData = await runModel(visionProvider);
      } catch (err) {
        console.error(`Primary provider (${visionProvider}) failed:`, err);
        if (fallbackProvider !== 'none' && fallbackProvider !== visionProvider) {
          console.log(`Trying fallback provider: ${fallbackProvider}`);
          parsedData = await runModel(fallbackProvider);
        } else {
          throw err;
        }
      }

      // Save to database
      const insertReceipt = await db.execute({
        sql: "INSERT INTO receipts (storeName, date, total) VALUES (?, ?, ?) RETURNING id",
        args: [parsedData.storeName, parsedData.date, parsedData.total]
      });
      const receiptId = (insertReceipt.rows[0] as any).id;

      for (const item of parsedData.items) {
        await db.execute({
          sql: "INSERT INTO receipt_items (receiptId, name, category, price, quantity, upc, grocy_synced) VALUES (?, ?, ?, ?, ?, ?, 0)",
          args: [receiptId, item.name, item.category, item.price, item.quantity, item.upc || null]
        });
      }

      fs.unlinkSync(req.file.path);
      res.json({ success: true, receiptId, parsedData });
    } catch (err: any) {
      console.error(err);
      if (req.file) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      res.status(500).json({ error: err.message || "Failed to process receipt" });
    }
  });

  // GET Settings proxy (if we want to use GET /api/settings we already have it, but we need endpoints for syncing)
  
  // GET Grocy Product Match
  app.get("/api/grocy/search", async (req, res) => {
    try {
      const settings = await getSettings();
      const { grocyUrl, grocyApiKey } = settings;
      if (!grocyUrl || !grocyApiKey) return res.status(400).json({ error: "Grocy not configured" });
      const baseUrl = getGrocyBaseUrl(grocyUrl);

      const name = req.query.name as string;
      const upc = req.query.upc as string;
      
      let matchedProduct = null;

      // 1. Try by barcode/UPC if available
      if (upc) {
        const upcRes = await fetch(`${baseUrl}/api/stock/products/by-barcode/${encodeURIComponent(upc)}`, {
          headers: { 'GROCY-API-KEY': grocyApiKey }
        });
        if (upcRes.ok) {
           const match = await upcRes.json();
           matchedProduct = match.product;
        }
      }

      // 2. Try by name
      if (!matchedProduct && name) {
        const nameRes = await fetch(`${baseUrl}/api/objects/products?query[]=name=${encodeURIComponent(name)}`, {
          headers: { 'GROCY-API-KEY': grocyApiKey }
        });
        if (nameRes.ok) {
           const matches = await nameRes.json();
           if (matches && matches.length > 0) {
             matchedProduct = matches[0];
           }
        }
      }

      // We also need locations and QUs for creation form
      const locationsRes = await fetch(`${baseUrl}/api/objects/locations`, { headers: { 'GROCY-API-KEY': grocyApiKey }});
      const quRes = await fetch(`${baseUrl}/api/objects/quantity_units`, { headers: { 'GROCY-API-KEY': grocyApiKey }});
      
      const locations = locationsRes.ok ? await locationsRes.json() : [];
      const quantityUnits = quRes.ok ? await quRes.json() : [];

      res.json({
        match: matchedProduct,
        locations,
        quantityUnits
      });

    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST Sync Item to Grocy
  app.post("/api/items/:id/ignore", async (req, res) => {
    try {
      await db.execute({
        sql: "UPDATE receipt_items SET ignored = 1 WHERE id = ?",
        args: [req.params.id]
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/grocy/products", async (req, res) => {
    try {
      const settings = await getSettings();
      if (!settings.grocyUrl || !settings.grocyApiKey) return res.json([]);
      const baseUrl = getGrocyBaseUrl(settings.grocyUrl);
      const gRes = await fetch(`${baseUrl}/api/objects/products`, {
        headers: { 'GROCY-API-KEY': settings.grocyApiKey }
      });
      if (!gRes.ok) return res.json([]);
      res.json(await gRes.json());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/items/:id/sync", async (req, res) => {
    try {
      const itemId = req.params.id;
      const { 
        productId, // if already exists
        createData, // if creating new
        amount, 
        price,
        barcode, // if adding barcode to existing or new
        quFactorPurchaseToStock
      } = req.body;

      const settings = await getSettings();
      const { grocyUrl, grocyApiKey, hermesWebhookUrl } = settings;
      if (!grocyUrl || !grocyApiKey) return res.status(400).json({ error: "Grocy not configured" });
      const baseUrl = getGrocyBaseUrl(grocyUrl);

      let finalProductId = productId;

      // Create product if it doesn't exist
      if (!finalProductId && createData) {
        const createRes = await fetch(`${baseUrl}/api/objects/products`, {
          method: 'POST',
          headers: { 'GROCY-API-KEY': grocyApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(createData)
        });
        if (!createRes.ok) {
           throw new Error(`Failed to create product: ${await createRes.text()}`);
        }
        const createdProduct = await createRes.json();
        finalProductId = createdProduct.created_object_id || createdProduct.id;

        // If a QU conversion factor is provided, create the conversion record
        if (quFactorPurchaseToStock && createData.qu_id_purchase && createData.qu_id_stock && createData.qu_id_purchase !== createData.qu_id_stock) {
           try {
             await fetch(`${baseUrl}/api/objects/quantity_unit_conversions`, {
               method: 'POST',
               headers: { 'GROCY-API-KEY': grocyApiKey, 'Content-Type': 'application/json' },
               body: JSON.stringify({
                 from_qu_id: createData.qu_id_purchase,
                 to_qu_id: createData.qu_id_stock,
                 factor: quFactorPurchaseToStock,
                 product_id: finalProductId
               })
             });
           } catch(e) {
             console.error("Failed to add QU conversion:", e);
           }
        }
      }

      if (!finalProductId) {
        return res.status(400).json({ error: "No product ID resolved" });
      }

      // Add barcode if provided (best effort)
      if (barcode) {
         try {
           await fetch(`${baseUrl}/api/objects/product_barcodes`, {
             method: 'POST',
             headers: { 'GROCY-API-KEY': grocyApiKey, 'Content-Type': 'application/json' },
             body: JSON.stringify({
                product_id: finalProductId,
                barcode: barcode
             })
           });
         } catch(e) {
           // ignore if already exists
         }
      }

      // Add to stock
      const addRes = await fetch(`${baseUrl}/api/stock/products/${finalProductId}/add`, {
        method: 'POST',
        headers: { 'GROCY-API-KEY': grocyApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amount,
          price: price,
          transaction_type: 'purchase'
        })
      });

      if (!addRes.ok) {
        throw new Error(`Failed to add stock: ${await addRes.text()}`);
      }

      // Update local db
      await db.execute({
        sql: "UPDATE receipt_items SET grocy_synced = 1 WHERE id = ?",
        args: [itemId]
      });

      // Notify Hermes
      if (hermesWebhookUrl) {
         try {
           // Get item details for hermes
           const itemRes = await db.execute({ sql: "SELECT i.*, r.storeName FROM receipt_items i JOIN receipts r ON i.receiptId = r.id WHERE i.id = ?", args: [itemId] });
           const itemData = itemRes.rows[0];
           
           await fetch(hermesWebhookUrl, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ 
               event: "inventory_updated", 
               source: "receipt_manager", 
               store: itemData?.storeName,
               items_added: [{
                 name: itemData?.name,
                 price: price,
                 quantity: amount,
                 grocy_product_id: finalProductId
               }]
             })
           });
         } catch(e) {
           console.error("Hermes notification failed", e);
         }
      }

      res.json({ success: true, productId: finalProductId });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
