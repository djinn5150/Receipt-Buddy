import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Settings, List, PieChart as PieChartIcon, Check, Loader2, ChevronLeft, ChevronRight, Calendar, ShoppingCart, Sun, Moon, Star } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { format, parseISO, addDays, isWithinInterval, startOfDay, endOfDay } from 'date-fns';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#ffc658'];

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'receipts' | 'items' | 'recipes'>('dashboard');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return document.documentElement.classList.contains('dark');
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);
  
  // Data
  const [receipts, setReceipts] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({});
  
  // Upload State
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Sync Modal State
  const [syncItemModalOpen, setSyncItemModalOpen] = useState(false);
  const [itemToSync, setItemToSync] = useState<any>(null);
  const [grocyMatch, setGrocyMatch] = useState<any>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [quantityUnits, setQuantityUnits] = useState<any[]>([]);
  const [syncLoading, setSyncLoading] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductLocation, setNewProductLocation] = useState('');
  const [newProductQUPurchase, setNewProductQUPurchase] = useState('');
  const [newProductQUStock, setNewProductQUStock] = useState('');
  const [newProductQUFactor, setNewProductQUFactor] = useState<number | string>(1);
  const [syncAmount, setSyncAmount] = useState<number | string>(1);
  const [newProductBarcode, setNewProductBarcode] = useState('');
  const [syncPrice, setSyncPrice] = useState<number | string>(0);
  const [syncMode, setSyncMode] = useState<'create' | 'map'>('create');
  const [grocyProducts, setGrocyProducts] = useState<any[]>([]);
  const [grocyStock, setGrocyStock] = useState<any[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [newProductParentId, setNewProductParentId] = useState('');

  // Recipe State
  const [recipeUrl, setRecipeUrl] = useState('');
  const [scrapingRecipe, setScrapingRecipe] = useState(false);
  const [scrapedRecipe, setScrapedRecipe] = useState<any>(null);
  const [recipeSyncing, setRecipeSyncing] = useState(false);
  const [recipeTab, setRecipeTab] = useState<'gallery' | 'mealplan' | 'scrape'>('gallery');
  const [selectedRecipeCategory, setSelectedRecipeCategory] = useState<string>('All');
  const [pendingRecipes, setPendingRecipes] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [mealPlan, setMealPlan] = useState<any[]>([]);
  const [viewingRecipeId, setViewingRecipeId] = useState<number | null>(null);
  const [viewingRecipe, setViewingRecipe] = useState<any>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [recipeSearch, setRecipeSearch] = useState('');
  
  const [recipePage, setRecipePage] = useState(1);
  const recipesPerPage = 12;
  const [mealPlanDays, setMealPlanDays] = useState(7);
  const [mealPlanStartDate, setMealPlanStartDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  useEffect(() => {
    setRecipePage(1);
  }, [selectedRecipeCategory]);

  const recipesByCategory = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    recipes.forEach(r => {
      const cat = r.userfields?.Category || r.category || 'Uncategorized';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(r);
    });
    // Sort categories alphabetically, with Uncategorized at the end
    const sortedKeys = Object.keys(grouped).sort((a, b) => {
      if (a === 'Uncategorized') return 1;
      if (b === 'Uncategorized') return -1;
      return a.localeCompare(b);
    });
    const sortedGrouped: Record<string, any[]> = {};
    sortedKeys.forEach(k => sortedGrouped[k] = grouped[k]);
    return sortedGrouped;
  }, [recipes]);

  const ignoreItem = async (id: number) => {
    try {
      await fetch(`/api/items/${id}/ignore`, { method: 'POST' });
      fetchData();
    } catch(e) {
      console.error("Failed to ignore item", e);
    }
  };

  const openSyncModal = async (item: any) => {
    setItemToSync(item);
    setSyncLoading(true);
    setSyncItemModalOpen(true);
    setGrocyMatch(null);
    setNewProductName(item.name);
    setNewProductBarcode(item.upc || '');
    setSyncAmount(item.quantity);
    setSyncPrice(item.price);
    setNewProductQUFactor(1);
    setSyncMode('create');
    setSelectedProductId('');
    setNewProductParentId('');
    try {
      const res = await fetch(`/api/grocy/search?name=${encodeURIComponent(item.name)}&upc=${encodeURIComponent(item.upc || '')}`);
      const data = await res.json();
      setGrocyMatch(data.match);
      if (data.match) {
        setSyncMode('map');
      }
      setLocations(Array.isArray(data.locations) ? data.locations : []);
      setQuantityUnits(Array.isArray(data.quantityUnits) ? data.quantityUnits : []);
      if (Array.isArray(data.locations) && data.locations.length > 0) setNewProductLocation(data.locations[0].id.toString());
      if (Array.isArray(data.quantityUnits) && data.quantityUnits.length > 0) {
        setNewProductQUPurchase(data.quantityUnits[0].id.toString());
        setNewProductQUStock(data.quantityUnits[0].id.toString());
      }
      const prodRes = await fetch('/api/grocy/products');
      if (prodRes.ok) {
        const prods = await prodRes.json();
        setGrocyProducts(Array.isArray(prods) ? prods : []);
      }
    } catch(e) {
      console.error(e);
    } finally {
      setSyncLoading(false);
    }
  };

  const handleSyncSubmit = async () => {
    if (!itemToSync) return;
    setSyncLoading(true);
    try {
      let body: any = {
        amount: Number(syncAmount),
        price: Number(syncPrice)
      };

      if (syncMode === 'map') {
        body.productId = grocyMatch ? grocyMatch.id : selectedProductId;
        body.barcode = newProductBarcode || undefined;
      } else {
        body.createData = {
          name: newProductName,
          location_id: parseInt(newProductLocation),
          qu_id_purchase: parseInt(newProductQUPurchase),
          qu_id_stock: parseInt(newProductQUStock)
        };
        if (newProductParentId) {
          body.createData.parent_product_id = parseInt(newProductParentId);
        }
        body.barcode = newProductBarcode || undefined;
        body.quFactorPurchaseToStock = Number(newProductQUFactor);
      }

      const res = await fetch(`/api/items/${itemToSync.id}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        setSyncItemModalOpen(false);
        fetchData();
      } else {
        const err = await res.json();
        alert('Sync failed: ' + err.error);
      }
    } catch(e) {
      console.error(e);
      alert('Error syncing');
    } finally {
      setSyncLoading(false);
    }
  };
  
  // Settings State
  const [grocyUrl, setGrocyUrl] = useState('');
  const [grocyApiKey, setGrocyApiKey] = useState('');
  const [hermesWebhookUrl, setHermesWebhookUrl] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  
  const [visionProvider, setVisionProvider] = useState('gemini');
  const [fallbackProvider, setFallbackProvider] = useState('none');
  const [customVisionUrl, setCustomVisionUrl] = useState('');
  const [customVisionApiKey, setCustomVisionApiKey] = useState('');
  const [customVisionModel, setCustomVisionModel] = useState('');

  // System Status State
  const [systemStatus, setSystemStatus] = useState<any>(null);

  const filteredMealPlan = useMemo(() => {
    try {
      const start = startOfDay(parseISO(mealPlanStartDate));
      const end = endOfDay(addDays(start, mealPlanDays - 1));
      return mealPlan.filter(plan => {
        const planDate = parseISO(plan.day);
        return isWithinInterval(planDate, { start, end });
      }).sort((a, b) => parseISO(a.day).getTime() - parseISO(b.day).getTime());
    } catch(e) {
      return mealPlan;
    }
  }, [mealPlan, mealPlanStartDate, mealPlanDays]);

  const filteredRecipes = useMemo(() => {
    let filtered = recipes;
    if (selectedRecipeCategory !== 'All') {
      filtered = filtered.filter(r => {
        const cat = r.userfields?.Category || r.category || 'Uncategorized';
        return cat === selectedRecipeCategory;
      });
    }
    if (recipeSearch.trim()) {
      const q = recipeSearch.toLowerCase();
      filtered = filtered.filter(r => {
        const nameMatch = (r.name || '').toLowerCase().includes(q);
        const descriptionMatch = (r.description || '').toLowerCase().includes(q);
        // We could also check ingredients if r.positions exists, or rely on name/description.
        // Actually, recipes from /api/grocy/recipes includes nested positions.
        let ingredientMatch = false;
        if (r.positions && Array.isArray(r.positions)) {
          ingredientMatch = r.positions.some((pos: any) => {
            const product = grocyProducts.find(p => p.id == pos.product_id);
            return product && product.name.toLowerCase().includes(q);
          });
        }
        return nameMatch || descriptionMatch || ingredientMatch;
      });
    }
    return filtered;
  }, [recipes, selectedRecipeCategory, recipeSearch, grocyProducts]);

  const totalRecipePages = Math.ceil(filteredRecipes.length / recipesPerPage);
  const paginatedRecipes = useMemo(() => {
    const start = (recipePage - 1) * recipesPerPage;
    return filteredRecipes.slice(start, start + recipesPerPage);
  }, [filteredRecipes, recipePage, recipesPerPage]);

  const fetchData = async () => {
    try {
      const [recRes, itemRes, setRes, statusRes, pendingRes, recipesRes, mealPlanRes, prodRes, quRes, stockRes] = await Promise.all([
        fetch('/api/receipts'),
        fetch('/api/items'),
        fetch('/api/settings'),
        fetch('/api/status'),
        fetch('/api/recipes/queue'),
        fetch('/api/grocy/recipes'),
        fetch('/api/grocy/meal_plan'),
        fetch('/api/grocy/products'),
        fetch('/api/grocy/quantity_units'),
        fetch('/api/grocy/stock')
      ]);
      setReceipts(await recRes.json());
      setItems(await itemRes.json());
      setPendingRecipes(await pendingRes.json());
      const rawRecipes = await recipesRes.json();
      setRecipes(Array.isArray(rawRecipes) ? rawRecipes.filter((r: any) => r.type !== 'mealplan-day' && !/^\d{4}-\d{2}(?:-\d{2})?(?:#\d+)?$/.test(r.name)) : []);
      setMealPlan(await mealPlanRes.json());
      
      const prods = await prodRes.json();
      setGrocyProducts(Array.isArray(prods) ? prods : []);
      
      const qus = await quRes.json();
      setQuantityUnits(Array.isArray(qus) ? qus : []);

      const stockData = await stockRes.json();
      setGrocyStock(Array.isArray(stockData) ? stockData : []);
      
      const setJson = await setRes.json();
      setSettings(setJson);
      
      try {
        const statusJson = await statusRes.json();
        setSystemStatus(statusJson);
      } catch (e) {
        console.error("Failed to parse status:", e);
      }

      setGrocyUrl(setJson.grocyUrl || '');
      setGrocyApiKey(setJson.grocyApiKey || '');
      setHermesWebhookUrl(setJson.hermesWebhookUrl || '');
      setGeminiApiKey(setJson.geminiApiKey || '');
      setVisionProvider(setJson.visionProvider || 'gemini');
      setFallbackProvider(setJson.fallbackProvider || 'none');
      setCustomVisionUrl(setJson.customVisionUrl || '');
      setCustomVisionApiKey(setJson.customVisionApiKey || '');
      setCustomVisionModel(setJson.customVisionModel || 'gpt-4o-mini');
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    let interval: any;
    if (pendingRecipes.length > 0 || recipeSyncing || scrapingRecipe) {
      interval = setInterval(() => {
        fetchData();
      }, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [pendingRecipes.length, recipeSyncing, scrapingRecipe]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('receipt', file);
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        setFile(null);
        await fetchData();
        setActiveTab('receipts');
      } else {
        const err = await res.json();
        alert('Upload failed: ' + err.error);
      }
    } catch (e) {
      console.error(e);
      alert('Upload error');
    } finally {
      setUploading(false);
    }
  };

  const handleViewRecipe = async (id: number) => {
    setViewingRecipeId(id);
    setViewingRecipe(null); // Clear previous
    try {
      const res = await fetch(`/api/grocy/recipes/${id}`);
      if (res.ok) {
        setViewingRecipe(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleScrapeRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipeUrl) return;
    setScrapingRecipe(true);
    setScrapedRecipe(null);
    try {
      const res = await fetch('/api/recipes/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: recipeUrl })
      });
      if (res.ok) {
        const data = await res.json();
        setScrapedRecipe(data);
        if (grocyProducts.length === 0) {
          const prodRes = await fetch('/api/grocy/products');
          if (prodRes.ok) {
            setGrocyProducts(await prodRes.json());
          }
        }
        if (quantityUnits.length === 0) {
          const quRes = await fetch('/api/grocy/quantity_units');
          if (quRes.ok) {
            setQuantityUnits(await quRes.json());
          }
        }
      } else {
        const err = await res.json();
        alert('Scraping failed: ' + err.error);
      }
    } catch (e) {
      alert('Error scraping recipe');
    } finally {
      setScrapingRecipe(false);
    }
  };

  const handleSyncRecipe = async () => {
    if (!scrapedRecipe) return;
    setRecipeSyncing(true);
    try {
      const res = await fetch('/api/recipes/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe: scrapedRecipe })
      });
      if (res.ok) {
        alert('Recipe synced to Grocy!');
        
        // Remove from pending queue if it was there
        const pendingMatch = pendingRecipes.find(pr => pr.url === recipeUrl);
        if (pendingMatch) {
          await fetch(`/api/recipes/queue/${pendingMatch.id}`, { method: 'DELETE' });
        }
        
        fetchData();

        setScrapedRecipe(null);
        setRecipeUrl('');
      } else {
        const err = await res.json();
        alert('Sync failed: ' + err.error);
      }
    } catch (e) {
      alert('Error syncing recipe');
    } finally {
      setRecipeSyncing(false);
    }
  };

  const handleRatingChange = async (newRating: number) => {
    if (!viewingRecipe) return;
    const currentFields = viewingRecipe.userfields || {};
    const updatedFields = { ...currentFields, Rating: newRating.toString() };
    
    setViewingRecipe({ ...viewingRecipe, userfields: updatedFields });
    setRecipes(prev => prev.map(r => r.id === viewingRecipe.id ? { ...r, userfields: updatedFields } : r));
    
    try {
      await fetch(`/api/grocy/recipes/${viewingRecipe.id}/userfields`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedFields)
      });
    } catch (e) {
      console.error("Failed to save rating");
    }
  };

  const handleDeleteRecipe = async (id: number) => {
    try {
      const res = await fetch(`/api/grocy/recipes/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setViewingRecipeId(null);
        setConfirmDeleteId(null);
        fetchData(); // Refresh recipes list
      } else {
        const err = await res.json();
        alert('Failed to delete recipe: ' + err.error);
      }
    } catch (e) {
      alert('Error deleting recipe');
    }
  };

  const [addingToShoppingList, setAddingToShoppingList] = useState(false);
  
  const handleAddMissingIngredients = async () => {
    if (!viewingRecipe || !viewingRecipe.positions) return;
    setAddingToShoppingList(true);
    let addedCount = 0;
    try {
      for (const pos of viewingRecipe.positions) {
        const stockItem = grocyStock.find(s => s.product_id === pos.product_id);
        const stockAmount = stockItem ? parseFloat(stockItem.amount) : 0;
        const requiredAmount = parseFloat(pos.amount);
        if (stockAmount < requiredAmount) {
          const missingAmount = requiredAmount - stockAmount;
          await fetch('/api/grocy/shopping_list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_id: pos.product_id, amount: missingAmount, note: `For recipe: ${viewingRecipe.name}` })
          });
          addedCount++;
        }
      }
      alert(`Added ${addedCount} missing ingredient(s) to shopping list.`);
    } catch (e) {
      alert('Error adding items to shopping list');
    } finally {
      setAddingToShoppingList(false);
    }
  };

  const saveSettings = async () => {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          grocyUrl, 
          grocyApiKey, 
          hermesWebhookUrl,
          geminiApiKey,
          visionProvider,
          fallbackProvider,
          customVisionUrl,
          customVisionApiKey,
          customVisionModel
        })
      });
      setSettingsOpen(false);
      fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  // Process data for charts
  const budgetByCategory = items.reduce((acc: any, item: any) => {
    const cost = item.price * item.quantity;
    acc[item.category] = (acc[item.category] || 0) + cost;
    return acc;
  }, {});

  const pieData = Object.keys(budgetByCategory).map(key => ({
    name: key,
    value: parseFloat(budgetByCategory[key].toFixed(2))
  }));

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[var(--bg)] text-[var(--ink)] font-sans">
      {/* Header */}
      <header className="px-8 py-6 border-b border-[var(--ink-faint)] flex justify-between items-center">
        <div className="label-text">[ Culinary Hub v2.0 ]</div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">Pantry Partner</h1>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="bg-transparent border-none cursor-pointer text-[var(--ink-medium)] hover:text-[var(--ink)] transition-colors"
            title="Toggle Theme"
          >
            {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button 
            onClick={() => setSettingsOpen(true)}
            className="bg-transparent border-none cursor-pointer text-[var(--ink-medium)] hover:text-[var(--ink)] transition-colors"
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-[280px_1fr] overflow-hidden">
        {/* Sidebar Nav */}
        <nav className="p-8 border-r border-[var(--ink-faint)] flex flex-col gap-8 overflow-y-auto custom-scrollbar">
          <div className="space-y-2">
            <div className="label-text mb-4">Primary</div>
            <button 
              className={`w-full flex items-center gap-3 py-2 text-sm text-left transition-colors ${activeTab === 'dashboard' ? 'text-[var(--ink)] font-medium' : 'text-[var(--ink-medium)] hover:text-[var(--ink)]'}`}
              onClick={() => setActiveTab('dashboard')}
            >
              Dashboard
            </button>
            <button 
              className={`w-full flex items-center gap-3 py-2 text-sm text-left transition-colors ${activeTab === 'receipts' ? 'text-[var(--ink)] font-medium' : 'text-[var(--ink-medium)] hover:text-[var(--ink)]'}`}
              onClick={() => setActiveTab('receipts')}
            >
              Receipts
            </button>
            <button 
              className={`w-full flex items-center gap-3 py-2 text-sm text-left transition-colors ${activeTab === 'items' as any ? 'text-[var(--ink)] font-medium' : 'text-[var(--ink-medium)] hover:text-[var(--ink)]'}`}
              onClick={() => setActiveTab('items' as any)}
            >
              Items & Sync
            </button>
            <button 
              className={`w-full flex items-center gap-3 py-2 text-sm text-left transition-colors ${activeTab === 'recipes' ? 'text-[var(--ink)] font-medium' : 'text-[var(--ink-medium)] hover:text-[var(--ink)]'}`}
              onClick={() => setActiveTab('recipes')}
            >
              Recipes
            </button>
          </div>

          {activeTab === 'recipes' && (
            <div className="space-y-2">
              <div className="label-text mb-4">Subsections</div>
              <div>
                <button 
                  className={`w-full flex items-center gap-3 py-2 text-sm text-left transition-colors ${recipeTab === 'gallery' ? 'text-[var(--ink)] font-medium' : 'text-[var(--ink-medium)] hover:text-[var(--ink)]'}`}
                  onClick={() => setRecipeTab('gallery')}
                >
                  Recipe Gallery
                </button>
                {recipeTab === 'gallery' && (
                  <div className="pl-6 space-y-1 mt-1 mb-2">
                    <button 
                      className={`w-full flex items-center justify-between py-1.5 text-sm text-left transition-colors ${selectedRecipeCategory === 'All' ? 'text-[var(--ink)] font-medium' : 'text-[var(--ink-medium)] hover:text-[var(--ink)]'}`}
                      onClick={() => setSelectedRecipeCategory('All')}
                    >
                      <span className="truncate">All Recipes</span>
                      <span className="text-xs opacity-60">{recipes.length}</span>
                    </button>
                    {Object.entries(recipesByCategory).map(([cat, catRecipes]: [string, any[]]) => (
                      <button 
                        key={cat}
                        className={`w-full flex items-center justify-between py-1.5 text-sm text-left transition-colors ${selectedRecipeCategory === cat ? 'text-[var(--ink)] font-medium' : 'text-[var(--ink-medium)] hover:text-[var(--ink)]'}`}
                        onClick={() => setSelectedRecipeCategory(cat)}
                      >
                        <span className="truncate">{cat}</span>
                        <span className="text-xs opacity-60">{catRecipes.length}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button 
                className={`w-full flex items-center gap-3 py-2 text-sm text-left transition-colors ${recipeTab === 'mealplan' ? 'text-[var(--ink)] font-medium' : 'text-[var(--ink-medium)] hover:text-[var(--ink)]'}`}
                onClick={() => setRecipeTab('mealplan')}
              >
                Meal Plan
              </button>
              <button 
                className={`w-full flex items-center gap-3 py-2 text-sm text-left transition-colors ${recipeTab === 'scrape' ? 'text-[var(--ink)] font-medium' : 'text-[var(--ink-medium)] hover:text-[var(--ink)]'}`}
                onClick={() => setRecipeTab('scrape')}
              >
                Add/Scrape Recipe
              </button>
            </div>
          )}
        </nav>

        <main className="p-8 overflow-y-auto custom-scrollbar flex flex-col gap-8">
          
          {/* System Status Banner */}
          {systemStatus && (systemStatus.grocy.status === "error" || systemStatus.grocy.status === "unconfigured" || systemStatus.vision.status === "error" || systemStatus.vision.status === "unconfigured") && (
            <div className="bg-red-50 border border-red-200 rounded p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-medium text-red-800 mb-1">System Configuration Warning</h3>
                <ul className="text-sm text-red-700 list-disc list-inside">
                  {systemStatus.grocy.status !== "ok" && (
                    <li>Grocy: {systemStatus.grocy.status} {systemStatus.grocy.error ? `(${systemStatus.grocy.error})` : ''}</li>
                  )}
                  {systemStatus.vision.status !== "ok" && (
                    <li>Vision API: {systemStatus.vision.status} {systemStatus.vision.error ? `(${systemStatus.vision.error})` : ''}</li>
                  )}
                </ul>
              </div>
              <button 
                onClick={() => setSettingsOpen(true)}
                className="px-4 py-2 bg-red-100 hover:bg-red-200 border border-red-200 rounded text-sm font-medium text-red-900 transition-colors whitespace-nowrap"
              >
                Open Settings
              </button>
            </div>
          )}



          {/* Content */}
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-[var(--surface)] border border-[var(--ink-faint)] p-8 shadow-sm">
              <h2 className="font-serif text-2xl font-semibold mb-6">Spending by Category</h2>
              <div className="h-64">
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={"cell-" + index} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#fff', borderColor: 'var(--ink-faint)', color: 'var(--ink)' }}
                        itemStyle={{ color: 'var(--ink)' }}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-[var(--ink-medium)] text-sm">
                    No data yet. Upload a receipt!
                  </div>
                )}
              </div>
            </div>
            
            <div className="bg-[var(--surface)] border border-[var(--ink-faint)] p-8 shadow-sm flex flex-col">
              <h2 className="font-serif text-2xl font-semibold mb-6">Recent Items</h2>
              <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {items.slice(0, 10).map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center py-3 border-b border-[var(--ink-faint)] last:border-0">
                    <div>
                      <p className="text-sm font-medium text-[var(--ink)]">{item.name}</p>
                      <p className="text-xs text-[var(--ink-medium)] mt-1">{item.category} • Qty: {item.quantity}</p>
                    </div>
                    <span className="text-sm font-mono text-[var(--ink-medium)]">${item.price.toFixed(2)}</span>
                  </div>
                ))}
                {items.length === 0 && <div className="text-sm text-[var(--ink-medium)]">No items extracted yet.</div>}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'receipts' && (
          <div className="flex flex-col gap-8">
            {/* Upload Widget */}
            <section className="border border-[var(--ink-faint)] bg-[var(--surface)] p-8 flex flex-col items-center text-center">
              <form onSubmit={handleUpload} className="w-full max-w-md flex flex-col items-center gap-4">
                <label 
                  htmlFor="file-upload" 
                  className={`w-full p-12 border border-dashed ${file ? 'border-[var(--accent)] bg-[var(--accent)]/5' : 'border-[var(--ink-medium)] cursor-pointer hover:bg-[var(--ink-faint)]'} transition-colors flex flex-col items-center justify-center`}
                >
                  <Upload className={`w-8 h-8 mb-4 ${file ? 'text-[var(--accent)]' : 'text-[var(--ink)]'}`} strokeWidth={1.2} />
                  <div className="label-text">Import Documents</div>
                  <p className="text-xs text-[var(--ink-medium)] mt-2">PNG, JPG, PDF up to 10MB</p>
                  <input 
                    id="file-upload" 
                    type="file" 
                    accept="image/*,.pdf"
                    className="hidden" 
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </label>
                {file && (
                  <div className="flex items-center justify-between w-full bg-[var(--ink-faint)] px-4 py-3 text-sm">
                    <span className="truncate max-w-[200px] text-[var(--ink)] font-medium">{file.name}</span>
                    <button 
                      type="submit" 
                      disabled={uploading}
                      className="bg-[var(--accent)] hover:bg-[#4a5847] text-white px-4 py-2 flex items-center gap-2 transition-colors disabled:opacity-50"
                    >
                      {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      {uploading ? 'Processing...' : 'Upload & Parse'}
                    </button>
                  </div>
                )}
              </form>
            </section>
            
            <div className="bg-[var(--surface)] border border-[var(--ink-faint)] shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-[var(--ink)]">
                <thead className="bg-[var(--bg)] text-xs uppercase text-[var(--ink-medium)] border-b border-[var(--ink-faint)] font-mono tracking-wider">
                  <tr>
                    <th className="px-6 py-4 font-normal">Store</th>
                    <th className="px-6 py-4 font-normal">Date</th>
                    <th className="px-6 py-4 font-normal text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ink-faint)]">
                  {receipts.map((r, i) => (
                    <tr key={i} className="hover:bg-[var(--ink-faint)] transition-colors">
                      <td className="px-6 py-4 font-medium">{r.storeName}</td>
                      <td className="px-6 py-4 text-[var(--ink-medium)]">{r.date}</td>
                      <td className="px-6 py-4 text-right font-mono">${r.total.toFixed(2)}</td>
                    </tr>
                  ))}
                  {receipts.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-6 py-8 text-center text-[var(--ink-medium)]">
                        No receipts found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          </div>
        )}
        
        {activeTab === 'items' as any && (
          <div className="bg-[var(--surface)] border border-[var(--ink-faint)] shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-[var(--ink)]">
                <thead className="bg-[var(--bg)] text-xs uppercase text-[var(--ink-medium)] border-b border-[var(--ink-faint)] font-mono tracking-wider">
                  <tr>
                    <th className="px-6 py-4 font-normal">Item</th>
                    <th className="px-6 py-4 font-normal">Receipt Date</th>
                    <th className="px-6 py-4 font-normal text-right">Qty & Price</th>
                    <th className="px-6 py-4 font-normal text-center">Sync Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ink-faint)]">
                  {items.map((item, i) => (
                    <tr key={i} className="hover:bg-[var(--ink-faint)] transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium">{item.name}</div>
                        <div className="text-xs text-[var(--ink-medium)] mt-1">{item.category} {item.upc ? `• UPC: ${item.upc}` : ''}</div>
                      </td>
                      <td className="px-6 py-4 text-[var(--ink-medium)]">{item.receiptDate}</td>
                      <td className="px-6 py-4 text-right">
                        <div>{item.quantity}x</div>
                        <div className="font-mono">${item.price.toFixed(2)}</div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {item.ignored ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-[var(--ink-faint)] bg-[var(--bg)] text-[var(--ink-medium)]">
                            <Check className="w-3 h-3" /> Ignored
                          </span>
                        ) : item.grocy_synced ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--accent)]">
                            <Check className="w-3 h-3" /> Synced
                          </span>
                        ) : (
                          <div className="flex gap-2 justify-center">
                            <button 
                              onClick={() => openSyncModal(item)}
                              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-[var(--ink)] hover:bg-black text-white transition-colors"
                            >
                              Sync to Grocy
                            </button>
                            <button 
                              onClick={() => ignoreItem(item.id)}
                              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm border border-[var(--ink-medium)] text-[var(--ink-medium)] hover:text-[var(--ink)] hover:border-[var(--ink)] transition-colors bg-[var(--surface)]"
                            >
                              Ignore
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-[var(--ink-medium)]">
                        No items found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        
        {activeTab === 'recipes' && (
          <div className="space-y-8">
            {recipeTab === 'gallery' && (
              <div className="space-y-8">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center pb-4 border-b border-[var(--ink-faint)] gap-4">
                  <h2 className="font-serif text-2xl font-semibold">
                    {selectedRecipeCategory === 'All' ? 'Recipe Gallery' : `${selectedRecipeCategory} Recipes`}
                  </h2>
                  <input
                    type="text"
                    value={recipeSearch}
                    onChange={(e) => {
                      setRecipeSearch(e.target.value);
                      setRecipePage(1);
                    }}
                    placeholder="Search by name or ingredient..."
                    className="bg-[var(--surface)] border border-[var(--ink-medium)] px-4 py-2 text-sm focus:outline-none focus:border-[var(--ink)] w-full sm:w-64"
                  />
                </div>

                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {paginatedRecipes.length === 0 ? (
                      <div className="col-span-full text-center text-[var(--ink-medium)] py-12 bg-[var(--surface)] rounded border border-[var(--ink-faint)]">
                        No recipes found. Scrape a recipe to get started.
                      </div>
                    ) : (
                      paginatedRecipes.map(recipe => (
                        <div 
                          key={recipe.id} 
                          className="bg-[var(--surface)] border border-[var(--ink-faint)] flex flex-col cursor-pointer group hover:shadow-sm transition-shadow"
                          onClick={() => handleViewRecipe(recipe.id)}
                        >
                          {recipe.picture_file_name ? (
                            <div className="h-56 bg-neutral-100 flex items-center justify-center overflow-hidden">
                              <img 
                                src={`/api/grocy/images/recipepictures/${btoa(recipe.picture_file_name)}`} 
                                alt={recipe.name}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                onError={(e) => {
                                   e.currentTarget.style.display = 'none';
                                }}
                              />
                            </div>
                          ) : (
                            <div className="h-56 bg-neutral-100 flex items-center justify-center border-b border-[var(--ink-faint)]">
                              <svg width="40" height="40" stroke="var(--ink-faint)" strokeWidth="1" fill="none"><rect x="2" y="2" width="20" height="20" rx="2"></rect></svg>
                            </div>
                          )}
                          <div className="p-6">
                            <h3 className="font-serif text-2xl font-semibold mb-2 leading-tight">{recipe.name}</h3>
                            <div className="line-clamp-2 text-sm leading-relaxed text-[var(--ink-medium)]" dangerouslySetInnerHTML={{ __html: recipe.description || '' }} />
                          </div>
                          <div className="mt-auto px-6 py-4 border-t border-[var(--ink-faint)] flex justify-between items-center">
                            {recipe.base_servings ? <span className="label-text">{recipe.base_servings} Servings</span> : <span />}
                            {(() => {
                               let link = "";
                               const ou = recipe.userfields?.original_url;
                               if (typeof ou === 'string' && ou.startsWith('{')) {
                                 try {
                                   link = JSON.parse(ou).link;
                                 } catch(e) {}
                               } else if (typeof ou === 'string' && ou.startsWith('http')) {
                                 link = ou;
                               }
                               if (link) {
                                 return (
                                   <a href={link} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline text-sm font-medium flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                     Source
                                   </a>
                                 );
                               }
                               return null;
                            })()}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {totalRecipePages > 1 && (
                    <div className="flex justify-center items-center gap-4 pt-8 border-t border-[var(--ink-faint)]">
                      <button
                        className="p-2 text-[var(--ink-medium)] hover:text-[var(--ink)] disabled:opacity-50 disabled:hover:text-[var(--ink-medium)] transition-colors bg-transparent border-none cursor-pointer"
                        disabled={recipePage === 1}
                        onClick={() => setRecipePage(p => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <span className="text-sm text-[var(--ink-medium)]">
                        Page <span className="text-[var(--ink)] font-medium">{recipePage}</span> of {totalRecipePages}
                      </span>
                      <button
                        className="p-2 text-[var(--ink-medium)] hover:text-[var(--ink)] disabled:opacity-50 disabled:hover:text-[var(--ink-medium)] transition-colors bg-transparent border-none cursor-pointer"
                        disabled={recipePage === totalRecipePages}
                        onClick={() => setRecipePage(p => Math.min(totalRecipePages, p + 1))}
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  )}
                </>
              </div>
            )}

            {recipeTab === 'mealplan' && (
              <div className="bg-[var(--surface)] border border-[var(--ink-faint)] shadow-sm">
                <div className="p-6 border-b border-[var(--ink-faint)] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <h2 className="font-serif text-2xl font-semibold">Meal Plan</h2>
                    <p className="text-sm text-[var(--ink-medium)]">View your planned meals from Grocy.</p>
                  </div>
                  <div className="flex items-center gap-3 bg-[var(--bg)] p-2 border border-[var(--ink-faint)]">
                    <Calendar className="w-4 h-4 text-[var(--ink-medium)]" />
                    <input 
                      type="date"
                      value={mealPlanStartDate}
                      onChange={e => setMealPlanStartDate(e.target.value)}
                      className="bg-transparent text-sm text-[var(--ink)] border-none outline-none focus:ring-0 custom-date-input"
                    />
                    <div className="w-px h-4 bg-[var(--ink-faint)]"></div>
                    <select
                      value={mealPlanDays}
                      onChange={e => setMealPlanDays(Number(e.target.value))}
                      className="bg-transparent text-sm text-[var(--ink)] border-none outline-none focus:ring-0"
                    >
                      <option value={1} className="bg-[var(--bg)] text-[var(--ink)]">1 Day</option>
                      <option value={3} className="bg-[var(--bg)] text-[var(--ink)]">3 Days</option>
                      <option value={7} className="bg-[var(--bg)] text-[var(--ink)]">7 Days</option>
                      <option value={14} className="bg-[var(--bg)] text-[var(--ink)]">14 Days</option>
                      <option value={30} className="bg-[var(--bg)] text-[var(--ink)]">30 Days</option>
                    </select>
                  </div>
                </div>
                <div className="p-8">
                  {filteredMealPlan.length === 0 ? (
                    <div className="text-center text-[var(--ink-medium)] py-12">
                      No meals planned for this timeframe.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {filteredMealPlan.map(plan => {
                        const isProduct = plan.type === 'product';
                        const recipe = !isProduct ? recipes.find(r => r.id === plan.recipe_id) : null;
                        const product = isProduct ? grocyProducts.find(p => p.id === plan.product_id) : null;
                        const qu = isProduct && plan.product_qu_id ? quantityUnits.find((q: any) => q.id === plan.product_qu_id) : null;
                        
                        return (
                          <div key={plan.id} className="flex items-center gap-6 bg-[var(--bg)] p-4 border border-[var(--ink-faint)]">
                            <div className="w-24 text-center">
                              <div className="text-xs text-[var(--ink-medium)] uppercase font-medium">{format(parseISO(plan.day), 'EEE')}</div>
                              <div className="text-xl text-[var(--ink)]">{format(parseISO(plan.day), 'd')}</div>
                            </div>
                            <div className="w-px h-12 bg-[var(--ink-faint)]"></div>
                            <div className="flex-1">
                              {isProduct ? (
                                <>
                                  <h4 className="text-[var(--ink)] font-medium text-lg">{product ? product.name : 'Unknown Product'}</h4>
                                  {plan.product_amount > 0 && <p className="text-sm text-[var(--ink-medium)] mt-1">{plan.product_amount} {qu ? qu.name : 'Units'}</p>}
                                </>
                              ) : (
                                <>
                                  <h4 className="text-[var(--ink)] font-medium text-lg">{recipe ? recipe.name : 'Unknown Recipe'}</h4>
                                  {plan.recipe_servings && <p className="text-sm text-[var(--ink-medium)] mt-1">{plan.recipe_servings} Servings</p>}
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {recipeTab === 'scrape' && (
              <div className="space-y-8">
                <div className="bg-[var(--surface)] border border-[var(--ink-faint)] p-8 shadow-sm">
                  <h2 className="font-serif text-2xl font-semibold mb-2">API Documentation: Add Recipes to Queue</h2>
                  <p className="text-sm text-[var(--ink-medium)] mb-6">
                    You or your AI agents can programmatically queue recipe URLs to be processed later.
                  </p>
                  <div className="bg-[var(--bg)] p-6 border border-[var(--ink-faint)] font-mono text-sm text-[var(--ink)]">
                    <div className="mb-4"><span className="text-[var(--accent)] font-bold">POST</span> /api/recipes/queue</div>
                    <div className="text-[var(--ink-medium)] mb-2">Headers:</div>
                    <div className="ml-4 mb-4">Content-Type: application/json</div>
                    <div className="text-[var(--ink-medium)] mb-2">Body:</div>
                    <div className="ml-4">{`{ "url": "https://example.com/recipe-url" }`}</div>
                  </div>
                </div>

                {pendingRecipes.length > 0 && (
                  <div className="bg-[var(--surface)] border border-[var(--ink-faint)] p-8 shadow-sm">
                    <h2 className="font-serif text-2xl font-semibold mb-6">Pending Recipe URLs (From API)</h2>
                    <div className="space-y-3">
                      {pendingRecipes.map((pr: any) => (
                        <div key={pr.id} className="flex items-center justify-between bg-[var(--bg)] p-4 border border-[var(--ink-faint)]">
                          <span className="text-sm text-[var(--ink)] truncate max-w-[70%] font-medium">{pr.url}</span>
                          <div className="flex gap-3">
                            <button 
                              className="px-4 py-2 bg-[var(--ink-faint)] text-[var(--ink)] hover:bg-[var(--ink-medium)] hover:text-white text-xs transition-colors"
                              onClick={() => setRecipeUrl(pr.url)}
                            >
                              Use URL
                            </button>
                            <button 
                              className="px-4 py-2 bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 text-xs transition-colors"
                              onClick={async () => {
                                await fetch(`/api/recipes/queue/${pr.id}`, { method: 'DELETE' });
                                fetchData();
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="bg-[var(--surface)] border border-[var(--ink-faint)] p-8 shadow-sm">
                  <h2 className="font-serif text-2xl font-semibold mb-6">Scrape Recipe</h2>
                  <form onSubmit={handleScrapeRecipe} className="flex gap-4">
                    <input
                      type="url"
                      placeholder="Paste recipe URL here..."
                      value={recipeUrl}
                      onChange={(e) => setRecipeUrl(e.target.value)}
                      className="flex-1 bg-[var(--bg)] border border-[var(--ink-faint)] px-4 py-3 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                      required
                    />
                    <button
                      type="submit"
                      disabled={scrapingRecipe || !recipeUrl}
                      className="bg-[var(--ink)] hover:bg-black text-white px-8 py-3 font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                    >
                  {scrapingRecipe ? <Loader2 className="w-4 h-4 animate-spin" /> : <List className="w-4 h-4" />}
                  {scrapingRecipe ? 'Scraping...' : 'Scrape Recipe'}
                </button>
              </form>
            </div>

            {scrapedRecipe && (
              <div className="bg-[var(--surface)] border border-[var(--ink-faint)] p-8 shadow-sm mt-8">
                <div className="flex justify-between items-start mb-8">
                  <div className="flex gap-6">
                    {scrapedRecipe.imageUrl && (
                      <img src={scrapedRecipe.imageUrl} alt={scrapedRecipe.name} className="w-24 h-24 object-cover border border-[var(--ink-faint)]" />
                    )}
                    <div>
                      <h2 className="font-serif text-2xl font-semibold mb-2">{scrapedRecipe.name}</h2>
                      <p className="text-sm text-[var(--ink-medium)] mb-4">{scrapedRecipe.description}</p>
                      <div className="flex items-center gap-3">
                        <label className="text-sm font-medium text-[var(--ink)]">Category</label>
                        <input
                          type="text"
                          className="bg-[var(--surface)] border border-[var(--ink-medium)] px-3 py-1.5 text-sm w-48 focus:outline-none focus:border-[var(--ink)]"
                          value={scrapedRecipe.category || ''}
                          onChange={(e) => setScrapedRecipe({ ...scrapedRecipe, category: e.target.value })}
                          placeholder="e.g. Dinner"
                        />
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={handleSyncRecipe}
                    disabled={recipeSyncing}
                    className="bg-[var(--accent)] hover:bg-[#4a5847] text-white px-8 py-3 font-medium flex items-center gap-2 transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {recipeSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {recipeSyncing ? 'Syncing...' : 'Sync to Grocy'}
                  </button>
                </div>
                
                <div className="space-y-6">
                  <h3 className="font-serif text-xl font-semibold">Ingredients</h3>
                  <datalist id="grocy-products-list">
                    {grocyProducts.map((p: any) => (
                      <option key={p.id} value={p.name} />
                    ))}
                  </datalist>
                  <datalist id="grocy-units-list">
                    {quantityUnits.map((qu: any) => (
                      <option key={qu.id} value={qu.name} />
                    ))}
                  </datalist>
                  <div className="bg-[var(--bg)] p-6 border border-[var(--ink-faint)] space-y-4">
                    {scrapedRecipe.ingredients?.map((ing: any, idx: number) => (
                      <div key={idx} className="flex justify-between items-center text-sm border-b border-[var(--ink-faint)] pb-4 last:border-0 last:pb-0 gap-6">
                        <div className="flex-1">
                          <span className="text-[var(--ink)] font-medium">{ing.originalString || ing.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <input 
                            type="number" 
                            step="0.01"
                            className="bg-[var(--surface)] border border-[var(--ink-medium)] px-3 py-2 w-20 text-xs text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]" 
                            value={ing.amount || ''} 
                            onChange={(e) => {
                              const newProds = [...(scrapedRecipe.ingredients || [])];
                              newProds[idx].amount = Number(e.target.value);
                              setScrapedRecipe({ ...scrapedRecipe, ingredients: newProds });
                            }}
                          />
                          <input 
                            list="grocy-units-list"
                            type="text" 
                            placeholder="Unit (Grocy)"
                            className="bg-[var(--surface)] border border-[var(--ink-medium)] px-3 py-2 w-28 text-xs text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]" 
                            value={ing.selectedQuName !== undefined ? ing.selectedQuName : ing.unit || ''} 
                            onChange={(e) => {
                              const newProds = [...(scrapedRecipe.ingredients || [])];
                              const val = e.target.value;
                              newProds[idx].unit = val;
                              newProds[idx].selectedQuName = val;
                              const quMatch = quantityUnits.find(qu => qu.name === val);
                              if (quMatch) {
                                newProds[idx].selectedQuId = quMatch.id;
                              } else {
                                newProds[idx].selectedQuId = null;
                              }
                              setScrapedRecipe({ ...scrapedRecipe, ingredients: newProds });
                            }}
                          />
                          <input
                            list="grocy-products-list"
                            type="text"
                            placeholder="Match Product..."
                            value={ing.grocyMatch?.name || ing.grocyMatchText || ''}
                            onChange={(e) => {
                              const newProds = [...(scrapedRecipe.ingredients || [])];
                              const val = e.target.value;
                              newProds[idx].grocyMatchText = val;
                              const match = grocyProducts.find(p => p.name === val);
                              if (match) {
                                newProds[idx].grocyMatch = match;
                                // Try to auto-select matching unit if found
                                if (!newProds[idx].selectedQuId) {
                                  const defaultQu = quantityUnits.find(qu => qu.id === match.qu_id_stock);
                                  if (defaultQu) {
                                    newProds[idx].selectedQuId = defaultQu.id;
                                    newProds[idx].selectedQuName = defaultQu.name;
                                    newProds[idx].unit = defaultQu.name;
                                  }
                                }
                              } else {
                                newProds[idx].grocyMatch = null;
                              }
                              setScrapedRecipe({ ...scrapedRecipe, ingredients: newProds });
                            }}
                            className="bg-[var(--surface)] border border-[var(--ink-medium)] px-3 py-2 text-xs text-[var(--ink)] w-[200px] focus:outline-none focus:border-[var(--ink)]"
                          />
                          {ing.grocyMatch ? (
                            <span className="text-[var(--accent)] text-xs flex items-center justify-center w-6">
                              <Check className="w-4 h-4" />
                            </span>
                          ) : (
                            <span className="text-yellow-600 font-bold text-xs flex items-center justify-center w-6" title="Unbound">
                              !
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            </div>
            )}
          </div>
        )}
      </main>
      </div>

      {/* Recipe View Modal */}
      <AnimatePresence>
      {viewingRecipeId && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6" 
          onClick={() => setViewingRecipeId(null)}
        >
          <motion.div 
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            className="bg-[var(--surface)] border border-[var(--ink-faint)] w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl" 
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            {!viewingRecipe ? (
              <div className="flex-1 flex items-center justify-center p-12">
                <Loader2 className="w-8 h-8 text-[var(--accent)] animate-spin" />
              </div>
            ) : (
              <>
                <div className="relative h-64 sm:h-80 bg-[var(--bg)] shrink-0 border-b border-[var(--ink-faint)]">
                  {viewingRecipe.picture_file_name ? (
                    <img 
                      src={`/api/grocy/images/recipepictures/${btoa(viewingRecipe.picture_file_name)}`} 
                      alt={viewingRecipe.name}
                      className="w-full h-full object-cover"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <List className="w-16 h-16 text-[var(--ink-faint)]" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
                  
                  <div className="absolute top-4 right-4 flex items-center gap-2">
                    {(() => {
                      let link = "";
                      const ou = viewingRecipe.userfields?.original_url;
                      if (typeof ou === 'string' && ou.startsWith('{')) {
                        try {
                          link = JSON.parse(ou).link;
                        } catch(e) {}
                      } else if (typeof ou === 'string' && ou.startsWith('http')) {
                        link = ou;
                      }
                      if (link) {
                        return (
                          <a href={link} target="_blank" rel="noopener noreferrer" title="Original Recipe" className="bg-white/20 hover:bg-white/40 text-white rounded p-2 backdrop-blur transition-colors border-none cursor-pointer flex items-center justify-center decoration-transparent">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                          </a>
                        );
                      }
                      return null;
                    })()}
                    <button
                      title="Add missing to Shopping List"
                      onClick={handleAddMissingIngredients}
                      disabled={addingToShoppingList}
                      className="bg-white/20 hover:bg-white/40 text-white rounded p-2 backdrop-blur transition-colors border-none cursor-pointer flex items-center justify-center disabled:opacity-50"
                    >
                      {addingToShoppingList ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShoppingCart className="w-5 h-5" />}
                    </button>
                    <a href={`${settings.grocyUrl}/recipe/${viewingRecipe.id}`} target="_blank" rel="noopener noreferrer" title="Edit in Grocy" className="bg-white/20 hover:bg-white/40 text-white rounded p-2 backdrop-blur transition-colors border-none cursor-pointer flex items-center justify-center decoration-transparent">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                    </a>
                    {confirmDeleteId === viewingRecipe.id ? (
                      <button 
                        title="Confirm Delete"
                        onClick={() => handleDeleteRecipe(viewingRecipe.id)}
                        className="bg-red-600 text-white rounded px-3 py-2 text-sm font-medium backdrop-blur transition-colors border-none cursor-pointer flex items-center justify-center whitespace-nowrap"
                      >
                        Confirm?
                      </button>
                    ) : (
                      <button 
                        title="Delete Recipe"
                        onClick={() => setConfirmDeleteId(viewingRecipe.id)}
                        className="bg-red-500/80 hover:bg-red-500 text-white rounded p-2 backdrop-blur transition-colors border-none cursor-pointer flex items-center justify-center"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                      </button>
                    )}
                    <button 
                      onClick={() => setViewingRecipeId(null)}
                      title="Close"
                      className="bg-white/20 hover:bg-white/40 text-white rounded p-2 backdrop-blur transition-colors border-none cursor-pointer flex items-center justify-center"
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                  </div>

                  <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8">
                    <h2 className="text-3xl sm:text-4xl font-serif font-bold text-white mb-2 leading-tight">{viewingRecipe.name}</h2>
                    <div className="flex flex-wrap items-center gap-3">
                      {viewingRecipe.base_servings && (
                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/20 backdrop-blur rounded text-sm font-medium text-white font-mono">
                          <PieChartIcon className="w-4 h-4" /> {viewingRecipe.base_servings} Servings
                        </div>
                      )}
                      <div className="inline-flex items-center gap-1 px-3 py-1 bg-white/20 backdrop-blur rounded text-sm font-medium text-white">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            onClick={(e) => { e.stopPropagation(); handleRatingChange(star); }}
                            className="bg-transparent border-none p-0 cursor-pointer focus:outline-none transition-transform hover:scale-110"
                          >
                            <Star 
                              className={`w-5 h-5 ${parseInt(viewingRecipe.userfields?.Rating || '0') >= star ? 'text-yellow-400 fill-yellow-400' : 'text-white/60'}`} 
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 sm:p-8 bg-[var(--surface)] text-[var(--ink)]">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 sm:gap-12">
                    <div className="lg:col-span-1 space-y-8">
                      <div>
                        <h3 className="font-serif text-xl font-semibold mb-4 flex items-center gap-2">
                          Ingredients
                        </h3>
                        {viewingRecipe.positions && viewingRecipe.positions.length > 0 ? (
                          <ul className="space-y-4">
                            {viewingRecipe.positions.map((pos: any) => {
                              const product = grocyProducts.find(p => p.id == pos.product_id);
                              const qu = quantityUnits.find(q => q.id == pos.qu_id);
                              
                              const stockItem = grocyStock.find(s => s.product_id === pos.product_id);
                              const stockAmount = stockItem ? parseFloat(stockItem.amount) : 0;
                              const requiredAmount = parseFloat(pos.amount);
                              const hasEnough = stockAmount >= requiredAmount;
                              const hasSome = stockAmount > 0;
                              
                              return (
                                <li key={pos.id} className="flex flex-col sm:flex-row sm:items-center justify-between items-start border-b border-[var(--ink-faint)] pb-3 last:border-0 text-sm gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-[var(--ink)]">{product ? product.name : `Product ID: ${pos.product_id}`}</span>
                                    {hasEnough ? (
                                      <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800 border border-green-200">In Stock</span>
                                    ) : hasSome ? (
                                      <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">Low Stock ({stockAmount})</span>
                                    ) : (
                                      <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">Out of Stock</span>
                                    )}
                                  </div>
                                  <span className="text-[var(--ink-medium)] whitespace-nowrap">
                                    {pos.amount} {qu ? qu.name : ''}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="text-[var(--ink-medium)] text-sm">No ingredients listed.</p>
                        )}
                      </div>
                    </div>
                    
                    <div className="lg:col-span-2 space-y-8">
                      <div>
                        <h3 className="font-serif text-xl font-semibold mb-4 flex items-center gap-2">
                          Instructions
                        </h3>
                        {viewingRecipe.description ? (
                          <div 
                            className="prose prose-sm max-w-none text-[var(--ink)] leading-relaxed marker:text-[var(--ink-medium)]"
                            dangerouslySetInnerHTML={{ __html: viewingRecipe.description }}
                          />
                        ) : (
                          <p className="text-[var(--ink-medium)] text-sm italic">No instructions provided.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Sync Item Modal */}
      <AnimatePresence>
      {syncItemModalOpen && itemToSync && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSyncItemModalOpen(false)}
        >
          <motion.div 
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            className="bg-[var(--surface)] border border-[var(--ink-faint)] w-full max-w-md p-8 shadow-xl max-h-[90vh] overflow-y-auto custom-scrollbar"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <h2 className="font-serif text-2xl font-semibold mb-2">Sync Item</h2>
            <p className="text-sm text-[var(--ink-medium)] mb-6">Review and sync <strong className="text-[var(--ink)]">{itemToSync.name}</strong> to Grocy.</p>
            
            {syncLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-8 h-8 text-[var(--accent)] animate-spin" />
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex gap-4 border-b border-[var(--ink-faint)] pb-6">
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input type="radio" checked={syncMode === 'create'} onChange={() => setSyncMode('create')} className="accent-[var(--ink)]" />
                    <span className={syncMode === 'create' ? 'text-[var(--ink)] font-medium' : 'text-[var(--ink-medium)]'}>Create New Product</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input type="radio" checked={syncMode === 'map'} onChange={() => { setSyncMode('map'); if (grocyMatch) setSelectedProductId(grocyMatch.id.toString()); }} className="accent-[var(--ink)]" />
                    <span className={syncMode === 'map' ? 'text-[var(--ink)] font-medium' : 'text-[var(--ink-medium)]'}>Map to Existing Product</span>
                  </label>
                </div>

                {syncMode === 'map' && (
                  <div className="space-y-4">
                    {grocyMatch && selectedProductId === grocyMatch.id?.toString() && (
                      <div className="bg-[var(--accent)]/5 border border-[var(--accent)] p-4">
                        <h3 className="text-sm font-medium text-[var(--accent)] flex items-center gap-2 mb-2">
                          <Check className="w-4 h-4" /> Exact Match Found
                        </h3>
                        <p className="text-sm text-[var(--ink)]">{grocyMatch.name}</p>
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-[var(--ink-medium)] mb-2">Select Grocy Product</label>
                      <select 
                        value={selectedProductId}
                        onChange={e => setSelectedProductId(e.target.value)}
                        className="w-full bg-[var(--bg)] border border-[var(--ink-faint)] px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                      >
                        <option value="">Select product...</option>
                        {grocyProducts.map((p: any) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {syncMode === 'create' && (
                  <div className="space-y-4">
                    <div className="bg-[var(--bg)] border border-[var(--ink-faint)] p-4">
                      <p className="text-xs text-[var(--ink-medium)]">Please provide details to create this product in Grocy.</p>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-[var(--ink-medium)] mb-2">Product Name</label>
                      <input 
                        type="text" 
                        value={newProductName}
                        onChange={e => setNewProductName(e.target.value)}
                        className="w-full bg-[var(--bg)] border border-[var(--ink-faint)] px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--ink-medium)] mb-2">Parent Product (Optional)</label>
                      <select 
                        value={newProductParentId}
                        onChange={e => setNewProductParentId(e.target.value)}
                        className="w-full bg-[var(--bg)] border border-[var(--ink-faint)] px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                      >
                        <option value="">None (Top-level product)</option>
                        {grocyProducts.map((p: any) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--ink-medium)] mb-2">Location</label>
                      <select 
                        value={newProductLocation}
                        onChange={e => setNewProductLocation(e.target.value)}
                        className="w-full bg-[var(--bg)] border border-[var(--ink-faint)] px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                      >
                        <option value="">Select location...</option>
                        {locations.map((loc: any) => (
                          <option key={loc.id} value={loc.id}>{loc.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-[var(--ink-medium)] mb-2">Unit (Purchase)</label>
                        <select 
                          value={newProductQUPurchase}
                          onChange={e => setNewProductQUPurchase(e.target.value)}
                          className="w-full bg-[var(--bg)] border border-[var(--ink-faint)] px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                        >
                          <option value="">Select unit...</option>
                          {quantityUnits.map((qu: any) => (
                            <option key={qu.id} value={qu.id}>{qu.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--ink-medium)] mb-2">Unit (Stock)</label>
                        <select 
                          value={newProductQUStock}
                          onChange={e => setNewProductQUStock(e.target.value)}
                          className="w-full bg-[var(--bg)] border border-[var(--ink-faint)] px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                        >
                          <option value="">Select unit...</option>
                          {quantityUnits.map((qu: any) => (
                            <option key={qu.id} value={qu.id}>{qu.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--ink-medium)] mb-1">Purchase to Stock Factor</label>
                      <p className="text-xs text-[var(--ink-medium)] opacity-70 mb-2">e.g., 1 box = 36 items</p>
                      <input 
                        type="number"
                        min="1"
                        step="any"
                        value={newProductQUFactor}
                        onChange={e => setNewProductQUFactor(e.target.value)}
                        className="w-full bg-[var(--bg)] border border-[var(--ink-faint)] px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                      />
                    </div>
                  </div>
                )}

                <div className="pt-6 border-t border-[var(--ink-faint)] grid grid-cols-2 gap-4 mt-2">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ink-medium)] mb-1">Purchase Amount</label>
                    <p className="text-xs text-[var(--ink-medium)] opacity-70 mb-2">How much of the purchase unit did you buy?</p>
                    <input 
                      type="number"
                      min="0"
                      step="any"
                      value={syncAmount}
                      onChange={e => setSyncAmount(e.target.value)}
                      className="w-full bg-[var(--bg)] border border-[var(--ink-faint)] px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ink-medium)] mb-1">Total Price</label>
                    <p className="text-xs text-[var(--ink-medium)] opacity-70 mb-2">Total price for this item on receipt.</p>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-[var(--ink-medium)]">$</span>
                      <input 
                        type="number"
                        min="0"
                        step="0.01"
                        value={syncPrice}
                        onChange={e => setSyncPrice(e.target.value)}
                        className="w-full bg-[var(--bg)] border border-[var(--ink-faint)] pl-7 pr-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ink-medium)] mb-1">UPC / Barcode (Optional)</label>
                  <p className="text-xs text-[var(--ink-medium)] opacity-70 mb-2">Will be added to the product if missing.</p>
                  <input 
                    type="text" 
                    value={newProductBarcode}
                    onChange={e => setNewProductBarcode(e.target.value)}
                    className="w-full bg-[var(--bg)] border border-[var(--ink-faint)] px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                  />
                </div>

                <div className="mt-8 flex justify-end gap-3 pt-4 border-t border-[var(--ink-faint)]">
                  <button 
                    onClick={() => setSyncItemModalOpen(false)}
                    className="px-6 py-2 text-sm text-[var(--ink-medium)] hover:text-[var(--ink)] transition-colors font-medium bg-transparent border-none cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleSyncSubmit}
                    className="px-6 py-2 text-sm bg-[var(--ink)] text-white hover:bg-black font-medium transition-colors border-none cursor-pointer"
                  >
                    {grocyMatch ? 'Sync Stock' : 'Create & Sync'}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] border border-[var(--ink-faint)] w-full max-w-2xl p-8 shadow-xl max-h-[90vh] overflow-y-auto custom-scrollbar">
            <h2 className="font-serif text-2xl font-semibold mb-6">Settings</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              {/* Integrations */}
              <div className="space-y-5">
                <h3 className="font-serif text-lg font-semibold border-b border-[var(--ink-faint)] pb-2 mb-4">Integrations</h3>
                <div>
                  <label className="block text-sm font-medium text-[var(--ink-medium)] mb-2">Grocy URL</label>
                  <input 
                    type="url" 
                    value={grocyUrl}
                    onChange={e => setGrocyUrl(e.target.value)}
                    placeholder="http://grocy.local"
                    className="w-full bg-[var(--bg)] border border-[var(--ink-faint)] px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-[var(--ink-medium)] mb-2">Grocy API Key</label>
                  <input 
                    type="password" 
                    value={grocyApiKey}
                    onChange={e => setGrocyApiKey(e.target.value)}
                    className="w-full bg-[var(--bg)] border border-[var(--ink-faint)] px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ink-medium)] mb-2">Hermes Webhook URL</label>
                  <input 
                    type="url" 
                    value={hermesWebhookUrl}
                    onChange={e => setHermesWebhookUrl(e.target.value)}
                    placeholder="http://hermes.local/webhook"
                    className="w-full bg-[var(--bg)] border border-[var(--ink-faint)] px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ink-medium)] mb-2">Gemini API Key (Optional)</label>
                  <input 
                    type="password" 
                    value={geminiApiKey}
                    onChange={e => setGeminiApiKey(e.target.value)}
                    placeholder="AI Studio API Key"
                    className="w-full bg-[var(--bg)] border border-[var(--ink-faint)] px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                  />
                </div>
              </div>

              {/* Vision Providers */}
              <div className="space-y-5">
                <h3 className="font-serif text-lg font-semibold border-b border-[var(--ink-faint)] pb-2 mb-4">Vision Providers</h3>
                <div>
                  <label className="block text-sm font-medium text-[var(--ink-medium)] mb-2">Primary Provider</label>
                  <select 
                    value={visionProvider}
                    onChange={e => setVisionProvider(e.target.value)}
                    className="w-full bg-[var(--bg)] border border-[var(--ink-faint)] px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                  >
                    <option value="gemini">Google Gemini (Server Default)</option>
                    <option value="custom">Custom (OpenAI Compatible)</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-[var(--ink-medium)] mb-2">Fallback Provider</label>
                  <select 
                    value={fallbackProvider}
                    onChange={e => setFallbackProvider(e.target.value)}
                    className="w-full bg-[var(--bg)] border border-[var(--ink-faint)] px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                  >
                    <option value="none">None</option>
                    <option value="gemini">Google Gemini (Server Default)</option>
                    <option value="custom">Custom (OpenAI Compatible)</option>
                  </select>
                </div>

                {(visionProvider === 'custom' || fallbackProvider === 'custom') && (
                  <div className="mt-6 p-5 bg-[var(--bg)] border border-[var(--ink-faint)] space-y-4">
                    <h4 className="text-xs font-semibold text-[var(--ink)] uppercase tracking-wider mb-2">Custom Provider Settings</h4>
                    <div>
                      <label className="block text-xs font-medium text-[var(--ink-medium)] mb-2">Load Preset</label>
                      <select 
                        className="w-full bg-[var(--surface)] border border-[var(--ink-medium)] px-3 py-1.5 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)] mb-3"
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'openai') {
                            setCustomVisionUrl('https://api.openai.com/v1');
                            setCustomVisionModel('gpt-4o-mini');
                          } else if (val === 'openrouter') {
                            setCustomVisionUrl('https://openrouter.ai/api/v1');
                            setCustomVisionModel('google/gemini-2.5-flash');
                          } else if (val === 'grok') {
                            setCustomVisionUrl('https://api.x.ai/v1');
                            setCustomVisionModel('grok-2-vision-latest');
                          } else if (val === 'claude') {
                            setCustomVisionUrl('https://openrouter.ai/api/v1');
                            setCustomVisionModel('anthropic/claude-3.5-sonnet');
                          }
                          e.target.value = '';
                        }}
                      >
                        <option value="">Select a preset...</option>
                        <option value="openai">OpenAI (ChatGPT)</option>
                        <option value="openrouter">OpenRouter</option>
                        <option value="grok">xAI (Grok)</option>
                        <option value="claude">Claude (via OpenRouter)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--ink-medium)] mb-2">API Base URL</label>
                      <input 
                        type="url" 
                        value={customVisionUrl}
                        onChange={e => setCustomVisionUrl(e.target.value)}
                        placeholder="https://api.openai.com/v1"
                        className="w-full bg-[var(--surface)] border border-[var(--ink-medium)] px-3 py-1.5 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--ink-medium)] mb-2">API Key</label>
                      <input 
                        type="password" 
                        value={customVisionApiKey}
                        onChange={e => setCustomVisionApiKey(e.target.value)}
                        className="w-full bg-[var(--surface)] border border-[var(--ink-medium)] px-3 py-1.5 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--ink-medium)] mb-2">Model Name</label>
                      <input 
                        type="text" 
                        value={customVisionModel}
                        onChange={e => setCustomVisionModel(e.target.value)}
                        placeholder="gpt-4o-mini"
                        className="w-full bg-[var(--surface)] border border-[var(--ink-medium)] px-3 py-1.5 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ink)]"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-10 flex justify-end gap-3 pt-6 border-t border-[var(--ink-faint)]">
              <button 
                onClick={() => setSettingsOpen(false)}
                className="px-6 py-2 text-sm text-[var(--ink-medium)] hover:text-[var(--ink)] font-medium transition-colors bg-transparent border-none cursor-pointer"
              >
                Cancel
              </button>
              <button 
                onClick={saveSettings}
                className="px-6 py-2 text-sm bg-[var(--ink)] text-white hover:bg-black font-medium transition-colors border-none cursor-pointer"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="px-8 py-4 border-t border-[var(--ink-faint)] bg-[var(--surface)] flex justify-between items-center z-10 relative">
        <div className="label-text">Page {String(recipePage).padStart(2, '0')} of {String(totalRecipePages || 1).padStart(2, '0')}</div>
        <div className="flex gap-4">
          <button 
            className="text-sm font-medium text-[var(--ink-medium)] hover:text-[var(--ink)] disabled:opacity-50 transition-colors bg-transparent border-none cursor-pointer"
            disabled={recipePage === 1}
            onClick={() => setRecipePage(p => Math.max(1, p - 1))}
          >
            &larr; Prev
          </button>
          <button 
            className="text-sm font-medium text-[var(--ink-medium)] hover:text-[var(--ink)] disabled:opacity-50 transition-colors bg-transparent border-none cursor-pointer"
            disabled={recipePage === totalRecipePages || totalRecipePages === 0}
            onClick={() => setRecipePage(p => Math.min(totalRecipePages, p + 1))}
          >
            Next &rarr;
          </button>
        </div>
        <div className="label-text">© {new Date().getFullYear()} Culinary System</div>
      </footer>
    </div>
  );
}
