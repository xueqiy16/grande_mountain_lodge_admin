import React from 'react';

const Sidebar = ({ currentTab, setTab, isManager = false }) => {
  const menuGroups = [
    { label: "Front Desk", items: ["Calendar", "Check-In", "Check-Out"] },
    { label: "Rooms", items: ["All", "Available", "Occupied", "Housekeeping"] },
    { label: "Financials", items: ["Guest Folio", "Daily Audit"] },
    { label: "System", items: ["Inventory", "Manager"] }
  ];

  return (
    <div className="sidebar">
      {menuGroups.map(group => (
        <div key={group.label} className="nav-group">
          <div className="nav-label">{group.label}</div>
          {group.items.map(item => {
            // The Manager tab is restricted to the lodge manager account. For
            // everyone else it renders muted and non-interactive.
            const restricted = item === 'Manager' && !isManager;
            return (
              <div
                key={item}
                className={`nav-item ${currentTab === item ? 'active' : ''} ${restricted ? 'nav-item-restricted' : ''}`}
                onClick={() => {
                  if (restricted) return;
                  setTab(item); // This updates currentTab AND filterStatus
                }}
                aria-disabled={restricted}
                title={restricted ? 'Manager access only' : undefined}
              >
                {item}
              </div>
            );
          })}
        </div>
      ))}

      <div style={{ marginTop: 'auto', padding: '20px', fontSize: '0.7rem', opacity: 0.5 }}>
        Grande Mountain Lodge<br/>PMS v1.0.0
      </div>
    </div>
  );
};

export default Sidebar;
