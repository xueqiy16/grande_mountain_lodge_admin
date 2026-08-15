import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import Sidebar from './Sidebar';
import './App.css';
import WalkInModal from './WalkInModal';
import CheckInModal from './CheckInModal';
import GuestFolio from './components/GuestFolio';
import CalendarView from './components/CalendarView';
import ManagerView from './components/ManagerView';
import { STAFF_MEMBERS } from './lib/constants';
import { calculateAmountPaid, roundToCents } from './lib/payments';
import { computeTotalStayCost } from './lib/costing';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './Login';

function App() {
  const [session, setSession] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [currentTab, setCurrentTab] = useState('Calendar');
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [selectedFolioId, setSelectedFolioId] = useState(null);
  const profileNameByEmail = {
    'reception@grandemountainlodge.com': 'Front Desk',
    'zypeny@gmail.com': 'Ying Zhu',
  };
  const displayName = profileNameByEmail[session?.user?.email] || 'Lodge User';
  const avatarInitial = displayName.charAt(0).toUpperCase();
  // Only the lodge manager account may access the Manager tab.
  const isManager = session?.user?.email === 'zypeny@gmail.com';
  const [staffRecords, setStaffRecords] = useState([]);
  const [websiteDiscount, setWebsiteDiscount] = useState(0);
  // Active staff full names power every "Staff Member" dropdown across LodgeOS.
  // Falls back to the hard-coded roster if the staff table isn't populated yet.
  const activeStaffNames = staffRecords.length
    ? staffRecords
        .filter(s => s.is_active)
        .map(s => `${s.first_name || ''} ${s.last_name || ''}`.trim())
        .filter(Boolean)
    : STAFF_MEMBERS;
  const [searchTerm, setSearchTerm] = useState('');
  const [isWalkInOpen, setIsWalkInOpen] = useState(false);
  const [isCheckInModalOpen, setIsCheckInModalOpen] = useState(false);
  const [selectedCheckInBooking, setSelectedCheckInBooking] = useState(null);
  const [allTransactions, setAllTransactions] = useState([]);
  const [message, setMessage] = useState('');
  const [arrivalDate, setArrivalDate] = useState(new Date().toISOString().split('T')[0]);
  const [departureDate, setDepartureDate] = useState(new Date().toISOString().split('T')[0]);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session) {
        await Promise.all([fetchDashboardData(), fetchStaff(), fetchSettings()]);
      }
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        fetchDashboardData();
        fetchStaff();
        fetchSettings();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // Auto-close drawer when tab changes
  useEffect(() => {
    setSelectedRoom(null);
  }, [currentTab]);

  const fetchDashboardData = async () => {
    setDataLoading(true);
    try {
      const [roomsRes, bookingsRes, transactionsRes] = await Promise.all([
        // '*' safely pulls every column, including the newly added rooms.code field.
        // Disambiguate the room_types embed via the room_type_id FK: adding rooms.code
        // (a 2nd FK to room_types) made a bare room_types(*) ambiguous (PostgREST PGRST201).
        supabase.from('rooms').select('*, room_types!room_type_id(*)').order('room_number', { ascending: true }),
        // Embed transactions + folio_entries so booking.transactions is populated on refresh.
        // Explicit FK hints resolve PGRST201 ambiguity: room_types via room_type_id
        // (rooms.code is a 2nd FK), transactions via the fk_transactions_booking constraint.
        supabase.from('bookings').select('*, guests(*), rooms(*, room_types!room_type_id(*)), folio_entries(*), transactions!fk_transactions_booking(*)'),
        supabase.from('transactions').select('*')
      ]);

      // Supabase returns errors on the response object instead of throwing, so surface
      // them explicitly — otherwise a failed rooms fetch silently blanks the grid.
      if (roomsRes.error) console.error("ROOM FETCH ERROR:", roomsRes.error);
      if (bookingsRes.error) {
        console.error("Supabase Fetch Error:", bookingsRes.error);
      } else {
        console.log("Fetched Bookings Count:", bookingsRes.data?.length);
      }
      if (transactionsRes.error) console.error("TRANSACTIONS FETCH ERROR:", transactionsRes.error);

      if (roomsRes.data) setRooms(roomsRes.data);
      // Always populate booking state so a partial/empty result never leaves stale folios.
      setBookings(bookingsRes.data || []);
      if (transactionsRes.data) setAllTransactions(transactionsRes.data);
    } catch (error) {
      console.error("ROOM FETCH ERROR:", error);
    } finally {
      setDataLoading(false);
    }
  };

  // Pull the dynamic staff roster. If the table doesn't exist yet the app keeps
  // working off the hard-coded STAFF_MEMBERS fallback (activeStaffNames).
  const fetchStaff = async () => {
    const { data, error } = await supabase
      .from('staff')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) {
      console.error('STAFF FETCH ERROR:', error);
      return;
    }
    if (data) setStaffRecords(data);
  };

  const fetchSettings = async () => {
    const { data, error } = await supabase
      .from('hotel_settings')
      .select('website_discount')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      console.error('SETTINGS FETCH ERROR:', error);
      return;
    }
    if (data) setWebsiteDiscount(Number(data.website_discount ?? 0));
  };

  const saveWebsiteDiscount = async (value) => {
    const { error } = await supabase
      .from('hotel_settings')
      .upsert({ id: 1, website_discount: value, updated_at: new Date().toISOString() });
    if (error) {
      alert('Failed to save discount: ' + error.message);
      return false;
    }
    setWebsiteDiscount(Number(value));
    setMessage('Website discount updated.');
    return true;
  };

  const activeBooking = selectedRoom 
    ? bookings.find(b => 
        b.room_id === selectedRoom.room_id && 
        (b.booking_status === 'checked_in' || b.booking_status === 'confirmed')
      ) 
    : null;

  // Primary Status Helper - determines the single primary status for a room.
  // NOTE: compares DB enum values, but RETURNS UI labels (Occupied/Available/...).
  const getPrimaryStatus = (room, bookings) => {
    // Out-of-service is a physical lockdown state and outranks everything else:
    // the room must never read as sellable to front-desk staff.
    if (room.status === 'out-of-service') return 'Out of Service';
    // Only active bookings drive room status; cancelled/no_show/checked_out are ignored
    // so the room frees up and shows as Available again.
    const activeB = bookings.find(b =>
      b.room_id === room.room_id &&
      (b.booking_status === 'checked_in' || b.booking_status === 'confirmed')
    );
    if (activeB?.booking_status === 'checked_in') return 'Occupied';
    if (activeB?.booking_status === 'confirmed') return 'Available';
    if (room.status === 'house-keeping') return 'Dirty';
    return 'Available';
  };

  // Maps a display label to a safe CSS class suffix (e.g. 'Out of Service' -> 'out-of-service').
  const getStatusClass = (primaryStatus) => primaryStatus.toLowerCase().replace(/\s+/g, '-');

  const calculateTotalBalance = (booking) => {
    if (!booking || !booking.check_in || !booking.check_out || !booking.rooms?.room_types?.nightly_rate) return 0;
    const start = new Date(booking.check_in + "T00:00:00");
    const end = new Date(booking.check_out + "T00:00:00");
    const diffInMs = end.getTime() - start.getTime();
    const diffNights = Math.max(1, Math.ceil(diffInMs / (1000 * 60 * 60 * 24))); 
    return Number(diffNights) * Number(booking.rooms.room_types.nightly_rate);
  };

  const calculateOutstandingBalance = (booking) => {
    if (!booking) return 0;
    // Full stay cost = base + additional fees + GST + tourism levy − discounts,
    // computed live from folio_entries so it matches the Guest Details ledger.
    const { totalStayCost } = computeTotalStayCost(
      booking.rooms?.room_types?.nightly_rate,
      booking.check_in,
      booking.check_out,
      booking.folio_entries || []
    );
    // Settled payments only — pre-authorizations never reduce the outstanding balance.
    const paid = calculateAmountPaid(booking.transactions || []);
    // Round to cents so tiny float drift never surfaces as a phantom 1-cent balance.
    return roundToCents(totalStayCost - paid);
  };

  // Helper function to normalize dates to YYYY-MM-DD format
  const normalizeDate = (dateString) => {
    if (!dateString) return null;
    // If it's already in YYYY-MM-DD format, return as is
    if (typeof dateString === 'string' && dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return dateString;
    }
    // Otherwise, parse it and extract the date portion
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return null;
      return date.toISOString().split('T')[0];
    } catch (e) {
      return null;
    }
  };

  const handleCheckIn = (booking) => {
    // Open Check-In modal for card info
    setSelectedCheckInBooking(booking);
    setIsCheckInModalOpen(true);
  };

  const handleCheckInComplete = async (msg, updated) => {
    setMessage(msg);
    // Immediate local state sync so the UI reflects edits without waiting on refetch.
    if (updated?.booking_id) {
      setBookings(prev => prev.map(b => {
        if (b.booking_id !== updated.booking_id) return b;
        return {
          ...b,
          ...(updated.booking || {}),
          guests: { ...(b.guests || {}), ...(updated.guest || {}) }
        };
      }));
    }
    await fetchDashboardData();
    setIsCheckInModalOpen(false);
    setSelectedCheckInBooking(null);
  };

  const handleCheckOut = async (targetBooking = null) => {
    const bookingToProcess = targetBooking || activeBooking;
    if (!bookingToProcess) return;
    // Compare on cents, not raw floats: treat anything ≤ $0.00 (including tiny
    // negative/positive float drift) as fully settled and cleared for check-out.
    const balance = roundToCents(calculateOutstandingBalance(bookingToProcess));
    const isClearedForCheckout = balance <= 0.00;
    if (!isClearedForCheckout) {
      alert(`Settlement Required: This guest has an outstanding balance of $${balance.toFixed(2)}. Please record a payment before checking out.`);
      setSelectedFolioId(bookingToProcess.booking_id);
      setCurrentTab('Guest Folio');
      return;
    }
    try {
      // Room -> 'house-keeping' is synced by the DB trigger off this booking_status change.
      await supabase.from('bookings').update({ booking_status: 'checked_out' }).eq('booking_id', bookingToProcess.booking_id);
      setMessage(`Check-out complete.`);
      setSelectedRoom(null); fetchDashboardData(); 
    } catch (error) { alert("Check-out failed."); }
  };

  const handleCancelReservation = async (bookingId) => {
    if (!bookingId) return;
    if (!window.confirm("Cancel this reservation?")) return;
    // Soft cancel: preserve the row for the audit trail instead of deleting.
    // The DB trigger frees the room back to 'available' off this booking_status change.
    await supabase
      .from('bookings')
      .update({ booking_status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('booking_id', bookingId);
    setMessage("Reservation cancelled.");
    setSelectedRoom(null); fetchDashboardData();
  };

  const handleMarkNoShow = async (bookingId) => {
    if (!bookingId) return;
    if (!window.confirm("Mark this reservation as a no-show?")) return;
    // Soft state change: preserve the row, flag the guest never arrived.
    // The DB trigger frees the room back to 'available' off this booking_status change.
    await supabase
      .from('bookings')
      .update({ booking_status: 'no_show' })
      .eq('booking_id', bookingId);
    setMessage("Reservation marked as no-show.");
    setSelectedRoom(null); fetchDashboardData();
  };

  const handleMarkClean = async () => {
    if (!selectedRoom || selectedRoom.status !== 'house-keeping') return;
    await supabase.from('rooms').update({ status: 'available' }).eq('room_id', selectedRoom.room_id);
    setMessage(`Room ${selectedRoom.room_number} is ready.`);
    setSelectedRoom(null); fetchDashboardData();
  };

  if (loading) return <div className="loading-screen">Loading PMS...</div>;


    
             
  

  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route 
          path="/" 
          element={
            <ProtectedRoute>
              <div className="admin-layout">
                <header className="top-header">
                  <div className="header-brand">
                    <img src="/assets/logo.png" alt="Grande Mountain Lodge" className="header-logo" />
                    <h1>Grande Mountain Lodge</h1>
                    {dataLoading && <span className="data-loading-indicator">Updating…</span>}
                  </div>
                  <div className="header-search-container">
                    <input type="text" placeholder="Search by Room # or Guest Name..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                    <button onClick={() => setIsWalkInOpen(true)} className="tool-btn primary" style={{ marginLeft: '15px' }}>+ New Reservation</button>
                  </div>
                  <div className="header-profile-container">
                    <div className="header-profile" onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{displayName}</div>
                      <div className="profile-avatar">{avatarInitial}</div>
                    </div>
                    {profileDropdownOpen && (
                      <div className="profile-dropdown">
                        <button 
                          className="profile-dropdown-item" 
                          onClick={() => {
                            supabase.auth.signOut();
                            setProfileDropdownOpen(false);
                          }}
                        >
                          Logout
                        </button>
                      </div>
                    )}
                  </div>
                </header>

                <Sidebar currentTab={currentTab} setTab={setCurrentTab} isManager={isManager} />

                <main className="main-content">
                  {currentTab === 'Calendar' ? (
                    <CalendarView
                      bookings={bookings}
                      getOutstandingBalance={calculateOutstandingBalance}
                      onOpenFolio={(id) => { setSelectedFolioId(id); setCurrentTab('Guest Folio'); }}
                    />
                  ) : currentTab === 'Manager' ? (
                    isManager ? (
                      <ManagerView
                        supabase={supabase}
                        staffRecords={staffRecords}
                        refreshStaff={fetchStaff}
                        websiteDiscount={websiteDiscount}
                        onSaveDiscount={saveWebsiteDiscount}
                      />
                    ) : (
                      <div className="folio-view">
                        <div className="empty-view" style={{ textAlign: 'center' }}>
                          <h2 style={{ marginBottom: '8px' }}>Access Restricted</h2>
                          <p style={{ color: '#64748b' }}>The Manager area is available to lodge managers only.</p>
                          <button className="tool-btn primary" style={{ marginTop: '16px' }} onClick={() => setCurrentTab('Calendar')}>
                            Back to Calendar
                          </button>
                        </div>
                      </div>
                    )
                  ) : currentTab === 'Inventory' ? (
                    <div className="folio-view">
                      <div className="view-header">
                        <h2>Inventory & Maintenance Manager</h2>
                      </div>
                      <div style={{ marginBottom: '30px' }}>
                        <h3 style={{ marginBottom: '15px', color: '#64748b', fontSize: '0.9rem', textTransform: 'uppercase' }}>All Rooms</h3>
                        <table className="pms-table">
                          <thead>
                            <tr>
                              <th>Room Number</th>
                              <th>Room Type</th>
                              <th>Current Status</th>
                              <th>Maintenance Toggle</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rooms.map(room => {
                              const primaryStatus = getPrimaryStatus(room, bookings);
                              const statusClass = getStatusClass(primaryStatus);
                              return (
                                <tr key={room.room_id}>
                                  <td><strong>{room.room_number}</strong></td>
                                  <td>{room.room_types?.name}</td>
                                  <td><span className={`status-badge status-${statusClass}`}>{primaryStatus}</span></td>
                                  <td>
                                    {(room.status === 'available' || room.status === 'out-of-service') ? (
                                    <button
                                      onClick={async () => {
                                        const newStatus = room.status === 'available' ? 'out-of-service' : 'available';
                                        const { error } = await supabase
                                          .from('rooms')
                                          .update({ status: newStatus })
                                          .eq('room_id', room.room_id);
                                        if (!error) {
                                          setMessage(`Room ${room.room_number} ${newStatus === 'out-of-service' ? 'set to Out Of Service' : 'restored to Available'}.`);
                                          fetchDashboardData();
                                        } else {
                                          alert("Failed to update room status: " + error.message);
                                        }
                                      }}
                                      className="tool-btn"
                                      style={{ fontSize: '0.85rem', padding: '6px 12px' }}
                                    >
                                      {room.status === 'available' ? 'Set Out Of Service' : 'Restore to Available'}
                                    </button>
                                    ) : (
                                      <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>N/A (Room is {primaryStatus})</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div>
                        <h3 style={{ marginBottom: '15px', color: '#64748b', fontSize: '0.9rem', textTransform: 'uppercase' }}>Housekeeping Tracker (Dirty Rooms)</h3>
                        {rooms.filter(r => r.status === 'house-keeping').length > 0 ? (
                          <table className="pms-table">
                            <thead>
                              <tr>
                                <th>Room Number</th>
                                <th>Room Type</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rooms.filter(r => r.status === 'house-keeping').map(room => (
                                <tr key={room.room_id}>
                                  <td><strong>{room.room_number}</strong></td>
                                  <td>{room.room_types?.name}</td>
                                  <td><span className="status-badge status-dirty">Dirty</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="empty-view">No dirty rooms at this time.</div>
                        )}
                      </div>
                    </div>
                  ) : currentTab === 'Daily Audit' ? (
                    <div className="folio-view">
                      <div className="view-header">
                        <h2>Daily Audit Dashboard</h2>
                        <div className="pms-stats">
                          <div className="stat-pill">
                            Total Stay Revenue (In-House): <span style={{color: '#22c55e'}}>$
                              {Number(bookings
                                .filter(b => b.booking_status === 'checked_in')
                                .reduce((acc, b) => acc + (b.total_price != null ? Number(b.total_price) : Number(calculateTotalBalance(b))), 0)).toFixed(2)}
                            </span>
                          </div>
                          <div className="stat-pill">
                            Payments Collected (Today): <span style={{color: '#22c55e'}}>$
                              {Number(allTransactions
                                .filter(t => {
                                  // Voided transactions never count toward collected money.
                                  if (t.status === 'voided') return false;
                                  // Money actually collected = purchases + captured pre-auths (completions).
                                  if (t.transaction_type !== 'purchase' && t.transaction_type !== 'completion') return false;
                                  const today = new Date().toISOString().split('T')[0];
                                  const txnDate = normalizeDate(t.charged_at);
                                  return txnDate === today;
                                })
                                .reduce((acc, t) => acc + Number(t.amount || 0), 0)).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div style={{ marginBottom: '30px' }}>
                        <h3 style={{ marginBottom: '15px', color: '#64748b', fontSize: '0.9rem', textTransform: 'uppercase' }}>Pending Check-Outs (Today)</h3>
                        {(() => {
                          const today = new Date().toISOString().split('T')[0];
                          const pendingCheckouts = bookings.filter(b => 
                            normalizeDate(b.check_out) === today && b.booking_status === 'checked_in'
                          );
                          return pendingCheckouts.length > 0 ? (
                            <table className="pms-table">
                              <thead>
                                <tr>
                                  <th>Guest Name</th>
                                  <th>Room</th>
                                  <th>Outstanding Balance</th>
                                  <th>Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {pendingCheckouts.map(booking => (
                                  <tr key={booking.booking_id}>
                                    <td><strong>{booking.guests?.first_name} {booking.guests?.last_name}</strong></td>
                                    <td>{booking.rooms?.room_number}</td>
                                    <td style={{ color: '#ef4444' }}>${Number(calculateOutstandingBalance(booking)).toFixed(2)}</td>
                                    <td>
                                      <button onClick={() => handleCheckOut(booking)} className="tool-btn">
                                        Check-Out
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <div className="empty-view">No pending check-outs for today.</div>
                          );
                        })()}
                      </div>
                      <div>
                        <h3 style={{ marginBottom: '15px', color: '#64748b', fontSize: '0.9rem', textTransform: 'uppercase' }}>No-Shows (Expected Today)</h3>
                        {(() => {
                          const today = new Date().toISOString().split('T')[0];
                          const noShows = bookings.filter(b => 
                            normalizeDate(b.check_in) === today && b.booking_status === 'confirmed'
                          );
                          return noShows.length > 0 ? (
                            <table className="pms-table">
                              <thead>
                                <tr>
                                  <th>Guest Name</th>
                                  <th>Room</th>
                                  <th>Stay Dates</th>
                                  <th>Status</th>
                                  <th>Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {noShows.map(booking => (
                                  <tr key={booking.booking_id}>
                                    <td><strong>{booking.guests?.first_name} {booking.guests?.last_name}</strong></td>
                                    <td>{booking.rooms?.room_number}</td>
                                    <td>{booking.check_in} to {booking.check_out}</td>
                                    <td><span className="status-badge status-confirmed">Confirmed</span></td>
                                    <td>
                                      <button onClick={() => handleMarkNoShow(booking.booking_id)} className="tool-btn">
                                        Mark as No-Show
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <div className="empty-view">No no-shows for today.</div>
                          );
                        })()}
                      </div>
                    </div>
                  ) : currentTab === 'Guest Folio' ? (
                    <GuestFolio
                      bookings={bookings}
                      guests={bookings.map(b => b.guests).filter(Boolean)}
                      rooms={rooms}
                      transactions={allTransactions}
                      staffList={activeStaffNames}
                      refreshData={fetchDashboardData}
                      supabase={supabase}
                      openBookingId={selectedFolioId}
                      onDetailClose={() => setSelectedFolioId(null)}
                    />
                  ) : (
                    <>
                      {/* Toolbar for All Rooms tab - shows all buttons, greyed out unless matching room selected */}
                      {currentTab === 'All' && (
                        <div className="toolbar" style={{ marginTop: '10px' }}>
                          <button 
                            onClick={() => handleCheckOut()} 
                            className="tool-btn"
                            disabled={!selectedRoom || getPrimaryStatus(selectedRoom, bookings) !== 'Occupied'}
                          >
                            Check-Out
                          </button>
                          <button 
                            onClick={() => handleCancelReservation(activeBooking?.booking_id)} 
                            className="tool-btn"
                            disabled={!selectedRoom || activeBooking?.booking_status !== 'confirmed'}
                          >
                            Cancel Reservation
                          </button>
                          <button 
                            onClick={() => handleMarkNoShow(activeBooking?.booking_id)} 
                            className="tool-btn"
                            disabled={!selectedRoom || activeBooking?.booking_status !== 'confirmed'}
                          >
                            Mark as No-Show
                          </button>
                          <button 
                            onClick={handleMarkClean} 
                            className="tool-btn"
                            disabled={!selectedRoom || getPrimaryStatus(selectedRoom, bookings) !== 'Dirty'}
                          >
                            Mark as Clean
                          </button>
                        </div>
                      )}

                      {/* Toolbar for Occupied tab - only Check-Out button (always clickable, standard orange) */}
                      {currentTab === 'Occupied' && (
                        <div className="toolbar" style={{ marginTop: '10px' }}>
                          <button 
                            onClick={() => handleCheckOut()} 
                            className="tool-btn"
                          >
                            Check-Out
                          </button>
                        </div>
                      )}

                      {/* Toolbar for Housekeeping tab - only Mark as Clean button */}
                      {currentTab === 'Housekeeping' && (
                        <div className="toolbar" style={{ marginTop: '10px' }}>
                          <button 
                            onClick={handleMarkClean} 
                            className="tool-btn"
                          >
                            Mark as Clean
                          </button>
                        </div>
                      )}

                      {/* Available tab - no toolbar */}

                      {currentTab === 'Check-In' && (
                        <div className="arrivals-container">
                          <div className="view-header"><h2>Expected Check-Ins</h2><div className="date-selector"><label>DATE</label><input type="date" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} /></div></div>
                          {bookings.filter(b => normalizeDate(b.check_in) === arrivalDate && b.booking_status === 'confirmed').length > 0 ? (
                            <table className="pms-table">
                              <thead><tr><th style={{ width: '26%', minWidth: '180px' }}>Guest Name</th><th style={{ width: '16%', minWidth: '110px' }}>Room</th><th style={{ width: '20%' }}>Stay Dates</th><th style={{ width: '16%' }}>Outstanding</th><th style={{ width: '22%', minWidth: '200px' }}>Action</th></tr></thead>
                              <tbody>
                                {bookings.filter(b => normalizeDate(b.check_in) === arrivalDate && b.booking_status === 'confirmed').map(booking => {
                                  const rt = booking.rooms?.room_types;
                                  const roomTypeLabel = rt?.code || rt?.name || booking.rooms?.code || 'N/A';
                                  return (
                                  <tr key={booking.booking_id}>
                                    <td><strong>{booking.guests?.first_name} {booking.guests?.last_name}</strong></td>
                                    <td>
                                      <div className="guest-cell">
                                        <strong>Room {booking.rooms?.room_number ?? 'N/A'}</strong>
                                        <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{roomTypeLabel}</span>
                                      </div>
                                    </td>
                                    <td style={{ whiteSpace: 'nowrap' }}>{booking.check_in} to {booking.check_out}</td>
                                    <td style={{ color: '#ef4444' }}>${Number(calculateOutstandingBalance(booking)).toFixed(2)}</td>
                                    <td>
                                      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
                                        <button onClick={() => handleCheckIn(booking)} className="checkin-btn">Check-In</button>
                                        <button
                                          onClick={() => { setSelectedFolioId(booking.booking_id); setCurrentTab('Guest Folio'); }}
                                          className="tool-btn"
                                        >
                                          Guest Folio
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          ) : (
                            <div className="empty-view">No guests are checking in on this date.</div>
                          )}
                        </div>
                      )}

                      {currentTab === 'Check-Out' && (
                        <div className="arrivals-container">
                          <div className="view-header"><h2>Expected Check-Outs</h2><div className="date-selector"><label>DATE</label><input type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} /></div></div>
                          {bookings.filter(b => normalizeDate(b.check_out) === departureDate && b.booking_status === 'checked_in').length > 0 ? (
                            <table className="pms-table">
                              <thead><tr><th style={{ width: '26%', minWidth: '180px' }}>Guest Name</th><th style={{ width: '16%', minWidth: '110px' }}>Room</th><th style={{ width: '20%' }}>Stay Dates</th><th style={{ width: '16%' }}>Outstanding</th><th style={{ width: '22%', minWidth: '200px' }}>Action</th></tr></thead>
                              <tbody>
                                {bookings.filter(b => normalizeDate(b.check_out) === departureDate && b.booking_status === 'checked_in').map(booking => {
                                  const rt = booking.rooms?.room_types;
                                  const roomTypeLabel = rt?.code || rt?.name || booking.rooms?.code || 'N/A';
                                  const clearedForCheckout = roundToCents(calculateOutstandingBalance(booking)) <= 0;
                                  return (
                                  <tr key={booking.booking_id}>
                                    <td><strong>{booking.guests?.first_name} {booking.guests?.last_name}</strong></td>
                                    <td>
                                      <div className="guest-cell">
                                        <strong>Room {booking.rooms?.room_number ?? 'N/A'}</strong>
                                        <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{roomTypeLabel}</span>
                                      </div>
                                    </td>
                                    <td style={{ whiteSpace: 'nowrap' }}>{booking.check_in} to {booking.check_out}</td>
                                    <td style={{ color: '#ef4444' }}>${Number(calculateOutstandingBalance(booking)).toFixed(2)}</td>
                                    <td>
                                      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
                                        <button
                                          onClick={() => handleCheckOut(booking)}
                                          disabled={!clearedForCheckout}
                                          className={`checkout-btn ${clearedForCheckout ? 'checkout-ready' : ''}`}
                                        >
                                          Check-Out
                                        </button>
                                        <button
                                          onClick={() => { setSelectedFolioId(booking.booking_id); setCurrentTab('Guest Folio'); }}
                                          className="tool-btn"
                                        >
                                          Guest Folio
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          ) : (
                            <div className="empty-view">No guests are checking out on this date.</div>
                          )}
                        </div>
                      )}

                      {(currentTab !== 'Check-In' && currentTab !== 'Check-Out') && (
                        <div className="room-grid">
                          {rooms.filter(room => {
                            const primaryStatus = getPrimaryStatus(room, bookings);
                            const activeB = bookings.find(b => b.room_id === room.room_id);
                            const guestName = (activeB?.guests?.first_name || "").toLowerCase();
                            const nameMatch = guestName.includes(searchTerm.toLowerCase());
                            const roomMatch = room.room_number.toString().includes(searchTerm);
                            
                            let matchesStatus = true;
                            if (currentTab === 'Available') matchesStatus = primaryStatus === 'Available';
                            if (currentTab === 'Occupied') matchesStatus = primaryStatus === 'Occupied';
                            if (currentTab === 'Housekeeping') matchesStatus = primaryStatus === 'Dirty';
                            // "All" tab shows everything (incl. Out of Service so staff can see locked rooms)
                            
                            return (roomMatch || nameMatch) && matchesStatus;
                          }).map(room => {
                            const primaryStatus = getPrimaryStatus(room, bookings);
                            const statusClass = getStatusClass(primaryStatus);
                            const isOutOfService = primaryStatus === 'Out of Service';
                            
                            return (
                              <div
                                key={room.room_id}
                                className={`room-card ${statusClass === 'out-of-service' ? 'room-card-oos' : ''} ${selectedRoom?.room_id === room.room_id ? 'selected' : ''}`}
                                onClick={() => setSelectedRoom(room)}
                                aria-disabled={isOutOfService}
                                title={isOutOfService ? 'Room is out of service and cannot be booked' : undefined}
                              >
                                <div className="room-header"><span className="room-number">{room.room_number}</span><span className={`status-badge status-${statusClass}`}>{primaryStatus}</span></div>
                                <div className="room-info-type">{room.room_types?.name}</div>
                                <div className="room-info-price">${room.room_types?.nightly_rate}/night</div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                    </> // FIXED: Fragment closed here
                  )}

                  {/* DRAWER FOR MAIN DASHBOARD */}
                  {selectedRoom && currentTab !== 'Guest Folio' && activeBooking && (
                    <div className="detail-drawer">
                      <button onClick={() => setSelectedRoom(null)} className="close-drawer-btn" aria-label="Close">✕</button>
                      <div className="detail-section">
                        <h4>Guest & Stay</h4>
                        <div className="detail-row"><span className="detail-label">Name</span><span className="detail-value">{activeBooking.guests?.first_name} {activeBooking.guests?.last_name}</span></div>
                        <div className="detail-row"><span className="detail-label">Dates</span><span className="detail-value">{activeBooking.check_in} - {activeBooking.check_out}</span></div>
                      </div>
                      <div className="detail-section">
                        <h4>Financial Summary</h4>
                        <div className="detail-row"><span className="detail-label">Outstanding Balance</span><span className="detail-value" style={{color: '#ef4444', fontSize: '1.2rem'}}>${Number(calculateOutstandingBalance(activeBooking)).toFixed(2)}</span></div>
                        <button onClick={() => { setSelectedFolioId(activeBooking.booking_id); setCurrentTab('Guest Folio'); }} className="tool-btn primary" style={{ marginTop: '10px', width: '100%' }}>View Guest Folio</button>
                      </div>
                    </div>
                  )}

                  <WalkInModal isOpen={isWalkInOpen} onClose={() => setIsWalkInOpen(false)} staffList={activeStaffNames} onBookingComplete={(msg) => { setMessage(msg); fetchDashboardData(); }} />
                  <CheckInModal 
                    isOpen={isCheckInModalOpen} 
                    onClose={() => {
                      setIsCheckInModalOpen(false);
                      setSelectedCheckInBooking(null);
                    }} 
                    booking={selectedCheckInBooking}
                    staffList={activeStaffNames}
                    onCheckInComplete={handleCheckInComplete}
                  />
                  {message && <div className="toast-notification">{message}</div>}
                </main>
              </div>
            </ProtectedRoute>
          } 
        />
      </Routes>
    </Router>
  );
}

export default App;