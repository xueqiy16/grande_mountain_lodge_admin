import React from 'react';

// Inline calendar glyph for the Calendar nav item.
const CalendarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

// Per-item leading icons (only items with an entry render one).
const NAV_ICONS = {
  Calendar: <CalendarIcon />
};

const Sidebar = ({ currentTab, setTab }) => {
  const menuGroups = [
    { label: "Front Desk", items: ["Calendar", "Check-In", "Check-Out"] },
    { label: "Rooms", items: ["All", "Available", "Occupied", "Housekeeping"] },
    { label: "Financials", items: ["Guest Folio", "Daily Audit"] },
    { label: "System", items: ["Inventory"] }
  ];

  return (
    <div className="sidebar">
      {menuGroups.map(group => (
        <div key={group.label} className="nav-group">
          <div className="nav-label">{group.label}</div>
          {group.items.map(item => (
            <div 
              key={item} 
              className={`nav-item ${currentTab === item ? 'active' : ''}`}
              onClick={() => {
                setTab(item); // This updates currentTab AND filterStatus
              }}
            >
              {NAV_ICONS[item] && <span className="nav-item-icon">{NAV_ICONS[item]}</span>}
              {item}
            </div>
          ))}
        </div>
      ))}
      
      <div style={{ marginTop: 'auto', padding: '20px', fontSize: '0.7rem', opacity: 0.5 }}>
        Grande Mountain Lodge<br/>PMS v1.0.0
      </div>
    </div>
  );
};

export default Sidebar;
