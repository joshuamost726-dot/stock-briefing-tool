import React, { useState, useEffect } from 'react';
import './styles.css';

export default function StockBriefingApp() {
  const [stocks, setStocks] = useState([]);
  const [briefings, setBriefings] = useState([]);
  const [latestBriefing, setLatestBriefing] = useState(null);
  const [newTicker, setNewTicker] = useState('');
  const [email, setEmail] = useState('joshuamost726@gmail.com');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

  // Fetch stocks
  useEffect(() => {
    fetchStocks();
    fetchBriefings();
    fetchLatestBriefing();
  }, []);

  const fetchStocks = async () => {
    try {
      const res = await fetch(`${API_URL}/api/stocks`);
      const data = await res.json();
      setStocks(data);
    } catch (err) {
      console.error('Error fetching stocks:', err);
    }
  };

  const fetchBriefings = async () => {
    try {
      const res = await fetch(`${API_URL}/api/briefings`);
      const data = await res.json();
      setBriefings(data);
    } catch (err) {
      console.error('Error fetching briefings:', err);
    }
  };

  const fetchLatestBriefing = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/briefing/latest`);
      const data = await res.json();
      setLatestBriefing(data);
    } catch (err) {
      console.error('Error fetching latest briefing:', err);
    } finally {
      setLoading(false);
    }
  };

  const addStock = async (e) => {
    e.preventDefault();
    if (!newTicker.trim()) return;

    try {
      const res = await fetch(`${API_URL}/api/stocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: newTicker.toUpperCase() })
      });
      const data = await res.json();
      setStocks(data);
      setNewTicker('');
    } catch (err) {
      alert('Error adding stock. Make sure ticker is valid.');
    }
  };

  const removeStock = async (ticker) => {
    try {
      const res = await fetch(`${API_URL}/api/stocks/${ticker}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      setStocks(data);
    } catch (err) {
      console.error('Error removing stock:', err);
    }
  };

  const updateEmail = async () => {
    try {
      await fetch(`${API_URL}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      alert('Email updated!');
    } catch (err) {
      console.error('Error updating email:', err);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>📈 Stock Briefing Dashboard</h1>
        <p>Automated briefings at 8am, 1pm, and 5pm</p>
      </header>

      <nav className="tabs">
        <button
          className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          Dashboard
        </button>
        <button
          className={`tab ${activeTab === 'stocks' ? 'active' : ''}`}
          onClick={() => setActiveTab('stocks')}
        >
          Manage Stocks
        </button>
        <button
          className={`tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          History
        </button>
        <button
          className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
      </nav>

      <main className="content">
        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <section className="dashboard">
            <button className="refresh-btn" onClick={fetchLatestBriefing} disabled={loading}>
              {loading ? 'Loading...' : '🔄 Get Latest Briefing'}
            </button>

            {latestBriefing && (
              <div className="briefing-card">
                <h2>Current Briefing</h2>
                <pre>{latestBriefing.briefing}</pre>
              </div>
            )}

            <div className="stocks-grid">
              {stocks.map(stock => (
                <div key={stock.ticker} className="stock-item">
                  <h3>{stock.ticker}</h3>
                  <p>{stock.name}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Manage Stocks Tab */}
        {activeTab === 'stocks' && (
          <section className="stocks-section">
            <h2>Tracked Stocks</h2>
            <form onSubmit={addStock} className="add-stock-form">
              <input
                type="text"
                placeholder="Enter stock ticker (e.g., AAPL)"
                value={newTicker}
                onChange={(e) => setNewTicker(e.target.value)}
              />
              <button type="submit">Add Stock</button>
            </form>

            <div className="stocks-list">
              {stocks.map(stock => (
                <div key={stock.ticker} className="stock-row">
                  <div>
                    <strong>{stock.ticker}</strong>
                    <span>{stock.name}</span>
                  </div>
                  <button
                    className="remove-btn"
                    onClick={() => removeStock(stock.ticker)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <section className="history-section">
            <h2>Briefing History</h2>
            <div className="briefings-list">
              {briefings.length === 0 ? (
                <p>No briefings yet. They'll start appearing after the scheduled times.</p>
              ) : (
                briefings.map((b, i) => (
                  <details key={i} className="briefing-item">
                    <summary>
                      {new Date(b.timestamp).toLocaleString()}
                    </summary>
                    <pre>{b.content}</pre>
                  </details>
                ))
              )}
            </div>
          </section>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <section className="settings-section">
            <h2>Settings</h2>
            <div className="setting-group">
              <label>Email for Briefings</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button onClick={updateEmail}>Save Email</button>
            </div>

            <div className="info-box">
              <h3>Schedule</h3>
              <ul>
                <li>📅 8:00 AM - Morning briefing</li>
                <li>📅 1:00 PM - Mid-day update</li>
                <li>📅 5:00 PM - After-hours briefing</li>
              </ul>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
