import React, { useState, useEffect } from 'react';
import { Upload, Settings, List, PieChart as PieChartIcon, Check, Loader2 } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { format, parseISO } from 'date-fns';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#ffc658'];

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'receipts'>('dashboard');
  const [settingsOpen, setSettingsOpen] = useState(false);
  
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
  const [selectedProductId, setSelectedProductId] = useState('');
  const [newProductParentId, setNewProductParentId] = useState('');

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
  
  const [visionProvider, setVisionProvider] = useState('gemini');
  const [fallbackProvider, setFallbackProvider] = useState('none');
  const [customVisionUrl, setCustomVisionUrl] = useState('');
  const [customVisionApiKey, setCustomVisionApiKey] = useState('');
  const [customVisionModel, setCustomVisionModel] = useState('');

  // System Status State
  const [systemStatus, setSystemStatus] = useState<any>(null);

  const fetchData = async () => {
    try {
      const [recRes, itemRes, setRes, statusRes] = await Promise.all([
        fetch('/api/receipts'),
        fetch('/api/items'),
        fetch('/api/settings'),
        fetch('/api/status')
      ]);
      setReceipts(await recRes.json());
      setItems(await itemRes.json());
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

  const saveSettings = async () => {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          grocyUrl, 
          grocyApiKey, 
          hermesWebhookUrl,
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
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/50 p-4">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-medium tracking-tight flex items-center gap-2">
            <span className="text-neutral-400">Homelab</span> Receipt Manager
          </h1>
          <button 
            onClick={() => setSettingsOpen(true)}
            className="p-2 hover:bg-neutral-800 rounded-md transition-colors"
          >
            <Settings className="w-5 h-5 text-neutral-400" />
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 md:p-6 lg:p-8 space-y-8">
        
        {/* System Status Banner */}
        {systemStatus && (systemStatus.grocy.status === "error" || systemStatus.grocy.status === "unconfigured" || systemStatus.vision.status === "error" || systemStatus.vision.status === "unconfigured") && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium text-red-400 mb-1">System Configuration Warning</h3>
              <ul className="text-sm text-neutral-300 list-disc list-inside">
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
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-md text-sm font-medium transition-colors whitespace-nowrap"
            >
              Open Settings
            </button>
          </div>
        )}

        {/* Upload Widget */}
        <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 md:p-8 flex flex-col items-center justify-center">
          <form onSubmit={handleUpload} className="w-full max-w-md flex flex-col items-center gap-4">
            <div className="w-full">
              <label 
                htmlFor="file-upload" 
                className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed ${file ? 'border-blue-500 bg-blue-500/10' : 'border-neutral-700 bg-neutral-800/50 hover:bg-neutral-800'} rounded-lg cursor-pointer transition-colors`}
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className={`w-8 h-8 mb-3 ${file ? 'text-blue-500' : 'text-neutral-500'}`} />
                  <p className="mb-2 text-sm text-neutral-400">
                    <span className="font-semibold text-neutral-300">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-xs text-neutral-500">PNG, JPG up to 10MB</p>
                </div>
                <input 
                  id="file-upload" 
                  type="file" 
                  accept="image/*"
                  className="hidden" 
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </label>
            </div>
            {file && (
              <div className="flex items-center justify-between w-full bg-neutral-800 rounded px-4 py-2 text-sm">
                <span className="truncate max-w-[200px]">{file.name}</span>
                <button 
                  type="submit" 
                  disabled={uploading}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-md flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {uploading ? 'Processing...' : 'Upload & Parse'}
                </button>
              </div>
            )}
          </form>
        </section>

        {/* Tabs */}
        <div className="flex border-b border-neutral-800">
          <button 
            className={"px-4 py-2 border-b-2 font-medium text-sm transition-colors " + (activeTab === 'dashboard' ? 'border-blue-500 text-blue-500' : 'border-transparent text-neutral-400 hover:text-neutral-200')}
            onClick={() => setActiveTab('dashboard')}
          >
            <div className="flex items-center gap-2"><PieChartIcon className="w-4 h-4"/> Dashboard</div>
          </button>
          <button 
            className={"px-4 py-2 border-b-2 font-medium text-sm transition-colors " + (activeTab === 'receipts' ? 'border-blue-500 text-blue-500' : 'border-transparent text-neutral-400 hover:text-neutral-200')}
            onClick={() => setActiveTab('receipts')}
          >
            <div className="flex items-center gap-2"><List className="w-4 h-4"/> Receipts</div>
          </button>
          <button 
            className={"px-4 py-2 border-b-2 font-medium text-sm transition-colors " + (activeTab === 'items' as any ? 'border-blue-500 text-blue-500' : 'border-transparent text-neutral-400 hover:text-neutral-200')}
            onClick={() => setActiveTab('items' as any)}
          >
            <div className="flex items-center gap-2"><Check className="w-4 h-4"/> Items & Sync</div>
          </button>
        </div>

        {/* Content */}
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
              <h2 className="text-lg font-medium mb-6 text-neutral-200">Spending by Category</h2>
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
                        contentStyle={{ backgroundColor: '#171717', borderColor: '#262626', color: '#fff' }}
                        itemStyle={{ color: '#fff' }}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-neutral-500 text-sm">
                    No data yet. Upload a receipt!
                  </div>
                )}
              </div>
            </div>
            
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
              <h2 className="text-lg font-medium mb-4 text-neutral-200">Recent Items</h2>
              <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {items.slice(0, 10).map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center py-2 border-b border-neutral-800 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-neutral-200">{item.name}</p>
                      <p className="text-xs text-neutral-500">{item.category} • Qty: {item.quantity}</p>
                    </div>
                    <span className="text-sm font-mono text-neutral-400">${item.price.toFixed(2)}</span>
                  </div>
                ))}
                {items.length === 0 && <div className="text-sm text-neutral-500">No items extracted yet.</div>}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'receipts' && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-neutral-400">
                <thead className="bg-neutral-900/50 text-xs uppercase text-neutral-500 border-b border-neutral-800">
                  <tr>
                    <th className="px-6 py-3">Store</th>
                    <th className="px-6 py-3">Date</th>
                    <th className="px-6 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {receipts.map((r, i) => (
                    <tr key={i} className="hover:bg-neutral-800/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-neutral-200">{r.storeName}</td>
                      <td className="px-6 py-4">{r.date}</td>
                      <td className="px-6 py-4 text-right font-mono">${r.total.toFixed(2)}</td>
                    </tr>
                  ))}
                  {receipts.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-6 py-8 text-center text-neutral-500">
                        No receipts found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        
        {activeTab === 'items' as any && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-neutral-400">
                <thead className="bg-neutral-900/50 text-xs uppercase text-neutral-500 border-b border-neutral-800">
                  <tr>
                    <th className="px-6 py-3">Item</th>
                    <th className="px-6 py-3">Receipt Date</th>
                    <th className="px-6 py-3 text-right">Qty & Price</th>
                    <th className="px-6 py-3 text-center">Sync Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {items.map((item, i) => (
                    <tr key={i} className="hover:bg-neutral-800/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium text-neutral-200">{item.name}</div>
                        <div className="text-xs text-neutral-500 mt-1">{item.category} {item.upc ? `• UPC: ${item.upc}` : ''}</div>
                      </td>
                      <td className="px-6 py-4 text-neutral-300">{item.receiptDate}</td>
                      <td className="px-6 py-4 text-right">
                        <div>{item.quantity}x</div>
                        <div className="font-mono text-neutral-300">${item.price.toFixed(2)}</div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {item.ignored ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-neutral-500/10 text-neutral-400">
                            <Check className="w-3 h-3" /> Ignored
                          </span>
                        ) : item.grocy_synced ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400">
                            <Check className="w-3 h-3" /> Synced
                          </span>
                        ) : (
                          <div className="flex gap-2 justify-center">
                            <button 
                              onClick={() => openSyncModal(item)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                            >
                              Sync to Grocy
                            </button>
                            <button 
                              onClick={() => ignoreItem(item.id)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors"
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
                      <td colSpan={4} className="px-6 py-8 text-center text-neutral-500">
                        No items found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Sync Item Modal */}
      {syncItemModalOpen && itemToSync && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <h2 className="text-xl font-medium mb-2 text-neutral-100">Sync Item</h2>
            <p className="text-sm text-neutral-400 mb-6">Review and sync <strong>{itemToSync.name}</strong> to Grocy.</p>
            
            {syncLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex gap-4 border-b border-neutral-700 pb-4">
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input type="radio" checked={syncMode === 'create'} onChange={() => setSyncMode('create')} className="text-blue-500" />
                    <span className={syncMode === 'create' ? 'text-neutral-200' : 'text-neutral-400'}>Create New Product</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input type="radio" checked={syncMode === 'map'} onChange={() => { setSyncMode('map'); if (grocyMatch) setSelectedProductId(grocyMatch.id.toString()); }} className="text-blue-500" />
                    <span className={syncMode === 'map' ? 'text-neutral-200' : 'text-neutral-400'}>Map to Existing Product</span>
                  </label>
                </div>

                {syncMode === 'map' && (
                  <div className="space-y-4">
                    {grocyMatch && selectedProductId === grocyMatch.id?.toString() && (
                      <div className="bg-neutral-800/50 border border-green-500/20 rounded-lg p-4">
                        <h3 className="text-sm font-medium text-green-400 flex items-center gap-2 mb-2">
                          <Check className="w-4 h-4" /> Exact Match Found
                        </h3>
                        <p className="text-sm text-neutral-200">{grocyMatch.name}</p>
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-neutral-400 mb-1">Select Grocy Product</label>
                      <select 
                        value={selectedProductId}
                        onChange={e => setSelectedProductId(e.target.value)}
                        className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
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
                    <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-4">
                      <p className="text-xs text-neutral-400">Please provide details to create this product in Grocy.</p>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-neutral-400 mb-1">Product Name</label>
                      <input 
                        type="text" 
                        value={newProductName}
                        onChange={e => setNewProductName(e.target.value)}
                        className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral-400 mb-1">Parent Product (Optional)</label>
                      <select 
                        value={newProductParentId}
                        onChange={e => setNewProductParentId(e.target.value)}
                        className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
                      >
                        <option value="">None (Top-level product)</option>
                        {grocyProducts.map((p: any) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral-400 mb-1">Location</label>
                      <select 
                        value={newProductLocation}
                        onChange={e => setNewProductLocation(e.target.value)}
                        className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
                      >
                        <option value="">Select location...</option>
                        {locations.map((loc: any) => (
                          <option key={loc.id} value={loc.id}>{loc.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-neutral-400 mb-1">Unit (Purchase)</label>
                        <select 
                          value={newProductQUPurchase}
                          onChange={e => setNewProductQUPurchase(e.target.value)}
                          className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
                        >
                          <option value="">Select unit...</option>
                          {quantityUnits.map((qu: any) => (
                            <option key={qu.id} value={qu.id}>{qu.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-neutral-400 mb-1">Unit (Stock)</label>
                        <select 
                          value={newProductQUStock}
                          onChange={e => setNewProductQUStock(e.target.value)}
                          className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
                        >
                          <option value="">Select unit...</option>
                          {quantityUnits.map((qu: any) => (
                            <option key={qu.id} value={qu.id}>{qu.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral-400 mb-1">Purchase to Stock Factor</label>
                      <p className="text-xs text-neutral-500 mb-2">e.g., 1 box = 36 items</p>
                      <input 
                        type="number"
                        min="1"
                        step="any"
                        value={newProductQUFactor}
                        onChange={e => setNewProductQUFactor(e.target.value)}
                        className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t border-neutral-800 grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1">Purchase Amount</label>
                    <p className="text-xs text-neutral-500 mb-2">How much of the purchase unit did you buy?</p>
                    <input 
                      type="number"
                      min="0"
                      step="any"
                      value={syncAmount}
                      onChange={e => setSyncAmount(e.target.value)}
                      className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1">Total Price</label>
                    <p className="text-xs text-neutral-500 mb-2">Total price for this item on receipt.</p>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-neutral-400">$</span>
                      <input 
                        type="number"
                        min="0"
                        step="0.01"
                        value={syncPrice}
                        onChange={e => setSyncPrice(e.target.value)}
                        className="w-full bg-neutral-800 border border-neutral-700 rounded-md pl-7 pr-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-400 mb-1">UPC / Barcode (Optional)</label>
                  <p className="text-xs text-neutral-500 mb-2">Will be added to the product if missing.</p>
                  <input 
                    type="text" 
                    value={newProductBarcode}
                    onChange={e => setNewProductBarcode(e.target.value)}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="mt-8 flex justify-end gap-3">
                  <button 
                    onClick={() => setSyncItemModalOpen(false)}
                    className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleSyncSubmit}
                    className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-md font-medium transition-colors"
                  >
                    {grocyMatch ? 'Sync Stock' : 'Create & Sync'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <h2 className="text-xl font-medium mb-6 text-neutral-100">Settings</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Integrations */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-neutral-300 border-b border-neutral-800 pb-2 mb-4">Integrations</h3>
                <div>
                  <label className="block text-sm font-medium text-neutral-400 mb-1">Grocy URL</label>
                  <input 
                    type="url" 
                    value={grocyUrl}
                    onChange={e => setGrocyUrl(e.target.value)}
                    placeholder="http://grocy.local"
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-neutral-400 mb-1">Grocy API Key</label>
                  <input 
                    type="password" 
                    value={grocyApiKey}
                    onChange={e => setGrocyApiKey(e.target.value)}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-400 mb-1">Hermes Webhook URL</label>
                  <input 
                    type="url" 
                    value={hermesWebhookUrl}
                    onChange={e => setHermesWebhookUrl(e.target.value)}
                    placeholder="http://hermes.local/webhook"
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Vision Providers */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-neutral-300 border-b border-neutral-800 pb-2 mb-4">Vision Providers</h3>
                <div>
                  <label className="block text-sm font-medium text-neutral-400 mb-1">Primary Provider</label>
                  <select 
                    value={visionProvider}
                    onChange={e => setVisionProvider(e.target.value)}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
                  >
                    <option value="gemini">Google Gemini (Server Default)</option>
                    <option value="custom">Custom (OpenAI Compatible)</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-neutral-400 mb-1">Fallback Provider</label>
                  <select 
                    value={fallbackProvider}
                    onChange={e => setFallbackProvider(e.target.value)}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
                  >
                    <option value="none">None</option>
                    <option value="gemini">Google Gemini (Server Default)</option>
                    <option value="custom">Custom (OpenAI Compatible)</option>
                  </select>
                </div>

                {(visionProvider === 'custom' || fallbackProvider === 'custom') && (
                  <div className="mt-4 p-4 bg-neutral-800/50 rounded-md border border-neutral-700/50 space-y-3">
                    <h4 className="text-xs font-medium text-neutral-300 uppercase tracking-wider mb-2">Custom Provider Settings</h4>
                    <div>
                      <label className="block text-xs font-medium text-neutral-400 mb-1">Load Preset</label>
                      <select 
                        className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:border-blue-500 mb-3"
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
                      <label className="block text-xs font-medium text-neutral-400 mb-1">API Base URL</label>
                      <input 
                        type="url" 
                        value={customVisionUrl}
                        onChange={e => setCustomVisionUrl(e.target.value)}
                        placeholder="https://api.openai.com/v1"
                        className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-neutral-400 mb-1">API Key</label>
                      <input 
                        type="password" 
                        value={customVisionApiKey}
                        onChange={e => setCustomVisionApiKey(e.target.value)}
                        className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-neutral-400 mb-1">Model Name</label>
                      <input 
                        type="text" 
                        value={customVisionModel}
                        onChange={e => setCustomVisionModel(e.target.value)}
                        placeholder="gpt-4o-mini"
                        className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-8 flex justify-end gap-3">
              <button 
                onClick={() => setSettingsOpen(false)}
                className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={saveSettings}
                className="px-4 py-2 text-sm bg-neutral-100 text-neutral-900 hover:bg-white rounded-md font-medium transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global styles for custom scrollbar */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #262626; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #404040; }
      `}} />
    </div>
  );
}
