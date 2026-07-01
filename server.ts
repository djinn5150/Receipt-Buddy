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
    CREATE TABLE IF NOT EXISTS pending_recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
}

setupDb().catch(console.error);

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (i === retries - 1) throw error;
      if (error.status === 503 || error.status === 429 || (error.message && error.message.includes('503'))) {
        await new Promise(res => setTimeout(res, delay * (i + 1))); // Exponential backoff
      } else {
        throw error; // Don't retry other errors
      }
    }
  }
  throw new Error("Unreachable");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Fetch Settings Helper
  const getSettings = async () => {
    let envConfig: Record<string, string> = {};
    try {
      if (fs.existsSync(".env")) {
         envConfig = dotenv.parse(fs.readFileSync(".env"));
      }
    } catch(e) {}
    
    return {
      grocyUrl: process.env.GROCY_URL || envConfig.GROCY_URL || "",
      grocyApiKey: process.env.GROCY_API_KEY || envConfig.GROCY_API_KEY || "",
      hermesWebhookUrl: process.env.HERMES_WEBHOOK_URL || envConfig.HERMES_WEBHOOK_URL || "",
      visionProvider: process.env.VISION_PROVIDER || envConfig.VISION_PROVIDER || "gemini",
      fallbackProvider: process.env.FALLBACK_PROVIDER || envConfig.FALLBACK_PROVIDER || "none",
      customVisionUrl: process.env.CUSTOM_VISION_URL || envConfig.CUSTOM_VISION_URL || "",
      customVisionApiKey: process.env.CUSTOM_VISION_API_KEY || envConfig.CUSTOM_VISION_API_KEY || "",
      customVisionModel: process.env.CUSTOM_VISION_MODEL || envConfig.CUSTOM_VISION_MODEL || "",
      geminiApiKey: process.env.GEMINI_API_KEY || envConfig.GEMINI_API_KEY || ""
    };
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
      res.json(await getSettings());
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
        customVisionModel,
        geminiApiKey
      } = req.body;
      
      let envConfig: Record<string, string> = {};
      if (fs.existsSync(".env")) {
        envConfig = dotenv.parse(fs.readFileSync(".env"));
      }

      if (grocyUrl !== undefined) envConfig.GROCY_URL = grocyUrl;
      if (grocyApiKey !== undefined) envConfig.GROCY_API_KEY = grocyApiKey;
      if (hermesWebhookUrl !== undefined) envConfig.HERMES_WEBHOOK_URL = hermesWebhookUrl;
      if (visionProvider !== undefined) envConfig.VISION_PROVIDER = visionProvider;
      if (fallbackProvider !== undefined) envConfig.FALLBACK_PROVIDER = fallbackProvider;
      if (customVisionUrl !== undefined) envConfig.CUSTOM_VISION_URL = customVisionUrl;
      if (customVisionApiKey !== undefined) envConfig.CUSTOM_VISION_API_KEY = customVisionApiKey;
      if (customVisionModel !== undefined) envConfig.CUSTOM_VISION_MODEL = customVisionModel;
      if (geminiApiKey !== undefined) envConfig.GEMINI_API_KEY = geminiApiKey;

      let newEnvContent = "";
      for (const [k, v] of Object.entries(envConfig)) {
        newEnvContent += `${k}="${v.replace(/"/g, '\\"')}"\n`;
        process.env[k] = v;
      }
      fs.writeFileSync(".env", newEnvContent);

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
          const response = await withRetry(() => ai.models.generateContent({
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
          }));
          if (!response.text) throw new Error("No text in response");
          return JSON.parse(response.text);
        } else if (provider === 'custom') {
          if (!customVisionUrl || !customVisionApiKey) throw new Error("Custom Vision API settings missing");
          if (mimeType === 'application/pdf') throw new Error("Custom Vision provider does not support PDF files natively via image_url. Please use Gemini for PDF parsing.");
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

  app.get("/api/grocy/recipes", async (req, res) => {
    try {
      const settings = await getSettings();
      if (!settings.grocyUrl || !settings.grocyApiKey) return res.json([]);
      const baseUrl = getGrocyBaseUrl(settings.grocyUrl);
      const gRes = await fetch(`${baseUrl}/api/objects/recipes`, {
        headers: { 'GROCY-API-KEY': settings.grocyApiKey }
      });
      if (!gRes.ok) return res.json([]);
      res.json(await gRes.json());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/grocy/recipes/:id", async (req, res) => {
    try {
      const settings = await getSettings();
      if (!settings.grocyUrl || !settings.grocyApiKey) return res.status(400).json({ error: "Grocy not configured" });
      const baseUrl = getGrocyBaseUrl(settings.grocyUrl);
      
      const [recipeRes, posRes] = await Promise.all([
        fetch(`${baseUrl}/api/objects/recipes/${req.params.id}`, { headers: { 'GROCY-API-KEY': settings.grocyApiKey } }),
        fetch(`${baseUrl}/api/objects/recipes_pos?query[]=recipe_id=${req.params.id}`, { headers: { 'GROCY-API-KEY': settings.grocyApiKey } })
      ]);
      
      if (!recipeRes.ok) return res.status(404).json({ error: "Recipe not found" });
      
      const recipe = await recipeRes.json();
      const positions = posRes.ok ? await posRes.json() : [];
      
      res.json({ ...recipe, positions });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/grocy/recipes/:id", async (req, res) => {
    try {
      const settings = await getSettings();
      if (!settings.grocyUrl || !settings.grocyApiKey) return res.status(400).json({ error: "Grocy not configured" });
      const baseUrl = getGrocyBaseUrl(settings.grocyUrl);
      
      const gRes = await fetch(`${baseUrl}/api/objects/recipes/${req.params.id}`, { 
        method: 'DELETE',
        headers: { 'GROCY-API-KEY': settings.grocyApiKey } 
      });
      
      if (!gRes.ok) return res.status(gRes.status).json({ error: "Failed to delete recipe from Grocy" });
      
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/grocy/meal_plan", async (req, res) => {
    try {
      const settings = await getSettings();
      if (!settings.grocyUrl || !settings.grocyApiKey) return res.json([]);
      const baseUrl = getGrocyBaseUrl(settings.grocyUrl);
      const gRes = await fetch(`${baseUrl}/api/objects/meal_plan`, {
        headers: { 'GROCY-API-KEY': settings.grocyApiKey }
      });
      if (!gRes.ok) return res.json([]);
      res.json(await gRes.json());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/grocy/images/:group/:filename", async (req, res) => {
    try {
      const { group, filename } = req.params;
      const cacheDir = path.join(process.cwd(), 'data', 'images', group);
      const filePath = path.join(cacheDir, filename);

      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }

      const settings = await getSettings();
      if (!settings.grocyUrl || !settings.grocyApiKey) return res.status(400).json({ error: "Grocy not configured" });
      const baseUrl = getGrocyBaseUrl(settings.grocyUrl);

      const gRes = await fetch(`${baseUrl}/api/files/${group}/${filename}`, {
        headers: { 'GROCY-API-KEY': settings.grocyApiKey }
      });

      if (!gRes.ok) return res.status(gRes.status).send(await gRes.text());

      const arrayBuffer = await gRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      fs.writeFileSync(filePath, buffer);

      res.setHeader('Content-Type', gRes.headers.get('content-type') || 'application/octet-stream');
      res.send(buffer);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/grocy/stock", async (req, res) => {
    try {
      const settings = await getSettings();
      if (!settings.grocyUrl || !settings.grocyApiKey) return res.json([]);
      const baseUrl = getGrocyBaseUrl(settings.grocyUrl);
      const gRes = await fetch(`${baseUrl}/api/stock`, {
        headers: { 'GROCY-API-KEY': settings.grocyApiKey }
      });
      if (!gRes.ok) return res.json([]);
      res.json(await gRes.json());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/grocy/shopping_list", async (req, res) => {
    try {
      const { product_id, amount, note } = req.body;
      const settings = await getSettings();
      if (!settings.grocyUrl || !settings.grocyApiKey) return res.status(400).json({ error: "Grocy not configured" });
      const baseUrl = getGrocyBaseUrl(settings.grocyUrl);
      const gRes = await fetch(`${baseUrl}/api/objects/shopping_list`, {
        method: 'POST',
        headers: { 'GROCY-API-KEY': settings.grocyApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id,
          shopping_list_id: 1,
          amount: amount || 1,
          note: note || ''
        })
      });
      if (!gRes.ok) return res.status(gRes.status).json({ error: "Failed to add to shopping list" });
      res.json(await gRes.json());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/grocy/quantity_units", async (req, res) => {
    try {
      const settings = await getSettings();
      if (!settings.grocyUrl || !settings.grocyApiKey) return res.json([]);
      const baseUrl = getGrocyBaseUrl(settings.grocyUrl);
      const quRes = await fetch(`${baseUrl}/api/objects/quantity_units`, {
        headers: { 'GROCY-API-KEY': settings.grocyApiKey }
      });
      if (!quRes.ok) return res.json([]);
      res.json(await quRes.json());
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
      let stockAmount = amount;
      if (quFactorPurchaseToStock) {
        stockAmount = amount * Number(quFactorPurchaseToStock);
      } else if (finalProductId) {
        try {
          const pRes = await fetch(`${baseUrl}/api/objects/products/${finalProductId}`, {
            headers: { 'GROCY-API-KEY': grocyApiKey }
          });
          if (pRes.ok) {
            const p = await pRes.json();
            const convRes = await fetch(`${baseUrl}/api/objects/quantity_unit_conversions?query[]=product_id=${finalProductId}`, {
               headers: { 'GROCY-API-KEY': grocyApiKey }
            });
            if (convRes.ok) {
               const convs = await convRes.json();
               const conv = convs.find((c: any) => Number(c.from_qu_id) === Number(p.qu_id_purchase) && Number(c.to_qu_id) === Number(p.qu_id_stock));
               if (conv && conv.factor) {
                  stockAmount = amount * Number(conv.factor);
               }
            }
          }
        } catch (e) {
          console.error("Failed to fetch product for factor:", e);
        }
      }

      const addRes = await fetch(`${baseUrl}/api/stock/products/${finalProductId}/add`, {
        method: 'POST',
        headers: { 'GROCY-API-KEY': grocyApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: stockAmount,
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

  // Pending Recipes Queue Endpoints
  app.get("/api/recipes/queue", async (req, res) => {
    try {
      const result = await db.execute("SELECT * FROM pending_recipes ORDER BY createdAt DESC");
      res.json(result.rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/recipes/queue", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: "No URL provided" });
      await db.execute({
        sql: "INSERT INTO pending_recipes (url) VALUES (?)",
        args: [url]
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/recipes/queue/:id", async (req, res) => {
    try {
      await db.execute({
        sql: "DELETE FROM pending_recipes WHERE id = ?",
        args: [req.params.id]
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/recipes/scrape", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: "No URL provided" });

      const settings = await getSettings();
      if (!process.env.GEMINI_API_KEY) {
        return res.status(400).json({ error: "Gemini API Key missing" });
      }

      // Fetch URL content using Jina Reader for better parsing and bypassing some bot protections
      const urlRes = await fetch(`https://r.jina.ai/${url}`, {
        headers: {
          'Accept': 'application/json',
          'X-Return-Format': 'markdown'
        }
      });
      
      let contentToParse = "";
      if (urlRes.ok) {
        const jinaData = await urlRes.json();
        contentToParse = jinaData.data?.content || jinaData.data?.text || "";
      } else {
        // Fallback to normal fetch
        const fbRes = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        const html = await fbRes.text();
        const ldJsonMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
        let extractedLdJson = "";
        if (ldJsonMatches) {
          extractedLdJson = ldJsonMatches.join("\n");
        }
        contentToParse = extractedLdJson + "\n\n" + html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      }

      // Ask Gemini to extract
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: [
          { role: "user", parts: [{ text: `Extract the recipe from this content. Provide a JSON object with 'name' (string), 'description' (string), 'category' (string, optional - e.g. Breakfast, Dinner, Dessert, etc), 'imageUrl' (string, optional), 'ingredients' (array of objects with 'originalString' (string, exactly as written in the recipe), 'name' (string), 'amount' (number), 'unit' (string)), and 'instructions' (string, markdown formatted).\n\nIf no recipe is found, return empty fields.\n\nContent:\n${contentToParse.substring(0, 100000)}` }] }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              description: { type: Type.STRING },
              category: { type: Type.STRING, description: "Category of the recipe (e.g. Breakfast, Dinner, Dessert)" },
              imageUrl: { type: Type.STRING, description: "URL to the recipe image" },
              ingredients: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    originalString: { type: Type.STRING },
                    name: { type: Type.STRING },
                    amount: { type: Type.NUMBER },
                    unit: { type: Type.STRING }
                  }
                }
              },
              instructions: { type: Type.STRING }
            }
          }
        }
      }));

      const parsedRecipe = JSON.parse(response.text);
      parsedRecipe.originalUrl = url;

      // Fuzzy match ingredients with Grocy
      if (settings.grocyUrl && settings.grocyApiKey) {
        const baseUrl = getGrocyBaseUrl(settings.grocyUrl);
        const prodsRes = await fetch(`${baseUrl}/api/objects/products`, { headers: { 'GROCY-API-KEY': settings.grocyApiKey } });
        if (prodsRes.ok) {
          const products = await prodsRes.json();
          if (parsedRecipe && Array.isArray(parsedRecipe.ingredients)) {
            for (const ing of parsedRecipe.ingredients) {
              const match = products.find((p: any) => 
                p.name.toLowerCase().includes(ing.name.toLowerCase()) || 
                ing.name.toLowerCase().includes(p.name.toLowerCase())
              );
              if (match) {
                ing.grocyMatch = match;
              }
            }
          }
        }
      }

      res.json(parsedRecipe);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/recipes/sync", async (req, res) => {
    try {
      const { recipe } = req.body;
      const settings = await getSettings();
      if (!settings.grocyUrl || !settings.grocyApiKey) return res.status(400).json({ error: "Grocy not configured" });
      const baseUrl = getGrocyBaseUrl(settings.grocyUrl);

      let pictureFileName = null;
      if (recipe.imageUrl) {
        try {
          const imgRes = await fetch(recipe.imageUrl);
          if (imgRes.ok) {
            const arrayBuffer = await imgRes.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            pictureFileName = `recipe_${Date.now()}.jpg`;
            const uploadRes = await fetch(`${baseUrl}/api/files/recipepictures/${Buffer.from(pictureFileName).toString('base64')}`, {
              method: 'PUT',
              headers: { 
                'GROCY-API-KEY': settings.grocyApiKey,
                'Content-Type': 'application/octet-stream'
              },
              body: buffer
            });
            if (!uploadRes.ok) {
              console.error("Failed to upload image", await uploadRes.text());
              pictureFileName = null;
            }
          }
        } catch (e) {
          console.error("Error uploading image:", e);
        }
      }

      // Create Recipe
      const createRes = await fetch(`${baseUrl}/api/objects/recipes`, {
        method: 'POST',
        headers: { 'GROCY-API-KEY': settings.grocyApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: recipe.name,
          description: recipe.instructions, // Put instructions in description
          base_servings: 1, // Default
          desired_servings: 1,
          picture_file_name: pictureFileName || undefined
        })
      });

      if (!createRes.ok) throw new Error(`Failed to create recipe: ${await createRes.text()}`);
      const createdRecipe = await createRes.json();
      const recipeId = createdRecipe.created_object_id || createdRecipe.id;

      // Update Userfields
      try {
        await fetch(`${baseUrl}/api/userfields/recipes/${recipeId}`, {
          method: 'PUT',
          headers: { 'GROCY-API-KEY': settings.grocyApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            Category: recipe.category || '',
            original_url: recipe.originalUrl ? JSON.stringify({ title: recipe.name || '', link: recipe.originalUrl }) : ''
          })
        });
      } catch (e) {
        console.error("Error setting userfields:", e);
      }

      // Add Ingredients
      let defaultLocationId: number | null = null;
      let defaultQuId: number | null = null;

      for (const ing of recipe.ingredients) {
        let productId = ing.grocyMatch?.id;
        let quId = ing.selectedQuId || ing.grocyMatch?.qu_id_stock;

        // If no match was found, create a new product
        if (!productId) {
          if (!defaultLocationId) {
            const locRes = await fetch(`${baseUrl}/api/objects/locations`, { headers: { 'GROCY-API-KEY': settings.grocyApiKey }});
            const locs = locRes.ok ? await locRes.json() : [];
            defaultLocationId = locs.length > 0 ? locs[0].id : 1;
          }
          if (!defaultQuId) {
            const quRes = await fetch(`${baseUrl}/api/objects/quantity_units`, { headers: { 'GROCY-API-KEY': settings.grocyApiKey }});
            const qus = quRes.ok ? await quRes.json() : [];
            defaultQuId = qus.length > 0 ? qus[0].id : 1;
          }

          // Use grocyMatchText (from the search field) if user typed something but didn't select, otherwise name, otherwise originalString
          const newProductName = ing.grocyMatchText || ing.name || ing.originalString || "Unknown Ingredient";
          const prodQuId = ing.selectedQuId || defaultQuId;

          const prodCreateRes = await fetch(`${baseUrl}/api/objects/products`, {
            method: 'POST',
            headers: { 'GROCY-API-KEY': settings.grocyApiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: newProductName,
              location_id: defaultLocationId,
              qu_id_purchase: prodQuId,
              qu_id_stock: prodQuId
            })
          });

          if (prodCreateRes.ok) {
            const createdProd = await prodCreateRes.json();
            productId = createdProd.created_object_id || createdProd.id;
            quId = prodQuId;
          } else {
            console.error("Failed to create product for ingredient", newProductName, await prodCreateRes.text());
          }
        }

        if (productId) {
          await fetch(`${baseUrl}/api/objects/recipes_pos`, {
            method: 'POST',
            headers: { 'GROCY-API-KEY': settings.grocyApiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipe_id: recipeId,
              product_id: productId,
              amount: ing.amount || 1, // Default to 1 if amount is missing
              qu_id: quId, 
              only_check_single_unit_in_stock: 0
            })
          });
        }
      }

      res.json({ success: true, recipeId });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });
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
