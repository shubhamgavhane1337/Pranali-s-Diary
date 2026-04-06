import { useState, useEffect, useRef } from 'react';
import { useAppHelper } from '../store/AppContext';
import { format, addDays, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth, isToday } from 'date-fns';
import { Calendar, Plus, Check, Trash2, LayoutList, CalendarDays, Clock } from 'lucide-react';

const ToDo = () => {
  const { appData, addTask, toggleTask, deleteTask, markTaskSynced, gcalToken, setGcalToken } = useAppHelper();
  const [view, setView] = useState('daily'); 
  const [isSyncing, setIsSyncing] = useState(false);
  const syncingIds = useRef(new Set());
  
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [newTaskText, setNewTaskText] = useState('');
  const [taskDate, setTaskDate] = useState(todayStr);
  const [taskTime, setTaskTime] = useState('');
  const [isRoutine, setIsRoutine] = useState(false);

  const tomorrowStr = format(addDays(new Date(), 1), 'yyyy-MM-dd');

  const formatTimeString = (timeStr) => {
    if (!timeStr) return '';
    try {
      const [h, m] = timeStr.split(':');
      const d = new Date();
      d.setHours(h, m);
      return format(d, 'h:mm a');
    } catch {
      return timeStr;
    }
  };

  const handleAdd = (e) => {
    e.preventDefault();
    if (!newTaskText.trim()) return;
    
    addTask({
      text: newTaskText,
      date: taskDate,
      time: taskTime,
      completed: false,
      routine: isRoutine,
      gcalSynced: false,
      gcalEventId: null
    });
    setNewTaskText('');
    setTaskTime('');

    const tokenTimeStr = localStorage.getItem('gcalTokenTime');
    const isExpired = !gcalToken || (Date.now() - parseInt(tokenTimeStr || '0', 10) > 55 * 60 * 1000);
    if (isExpired && localStorage.getItem('autoConnectGcal') === 'true') {
      handleConnect(true);
    }
  };

  const handleDeleteTask = async (task) => {
    deleteTask(task.id);
    if (task.gcalSynced && task.gcalEventId && gcalToken) {
      try {
        await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${task.gcalEventId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${gcalToken}` }
        });
      } catch(err) {
        console.error('Failed to remotely delete Google Calendar event', err);
      }
    }
  };

  const pushEventsToCalendar = async (accessToken, silent = false) => {
    setIsSyncing(true);
    let tasksToSync = [];
    try {
      tasksToSync = appData.tasks.filter(t => !t.gcalSynced && !t.completed && !t.routine && !syncingIds.current.has(t.id));
      if (tasksToSync.length === 0) {
        if (!silent && !isSyncing) alert("All tasks are already synced!");
        return;
      }
      
      tasksToSync.forEach(t => syncingIds.current.add(t.id));
      
      let count = 0;
      for (const t of tasksToSync) {
        const timeToUse = t.time || '09:00';
        const startDateTime = new Date(`${t.date}T${timeToUse}:00`);
        const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000); 
        
        const event = {
          summary: t.text,
          description: 'Added via Pranali\'s Diary Web App',
          start: {
            dateTime: startDateTime.toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
          },
          end: {
            dateTime: endDateTime.toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
          }
        };

        const req = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(event)
        });
        
        if (req.ok) {
           const responseData = await req.json();
           markTaskSynced(t.id, responseData.id);
           count++;
        } else if (req.status === 401) {
           setGcalToken(null);
           if (!silent) alert("Your Google Calendar session has expired. Please connect again.");
           break;
        } else {
           console.error("GCal Sync Error", await req.text());
        }
      }
      if (!silent && count > 0) {
        alert(`Successfully connected and pushed ${count} task(s) to your Google Calendar!`);
      }
    } catch (err) {
      console.error(err);
      if (!silent) alert("An error occurred while communicating with Google Calendar APIs.");
    } finally {
      tasksToSync.forEach(t => syncingIds.current.delete(t.id));
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (gcalToken) {
      const unsynced = appData.tasks.filter(t => !t.gcalSynced && !t.completed && !t.routine);
      if (unsynced.length > 0) {
        pushEventsToCalendar(gcalToken, true);
      }
    }
  }, [appData.tasks, gcalToken]);

  const handleConnect = (auto) => {
    if (!window.google) {
      alert("Google server scripts are still loading or blocked. Ensure you are connected and disable ad-blockers for this site.");
      return;
    }

    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: '87294556154-tae9g95q9mt8uggmo0ltfgn4hol4dird.apps.googleusercontent.com',
      scope: 'https://www.googleapis.com/auth/calendar.events',
      callback: (response) => {
        if (response.error) {
          console.error('Authentication failed:', response);
          return;
        }
        setGcalToken(response.access_token);
        localStorage.setItem('gcalTokenTime', Date.now().toString());
        localStorage.setItem('autoConnectGcal', 'true');
      },
    });

    if (auto === true) {
      client.requestAccessToken({ prompt: '' });
    } else {
      client.requestAccessToken();
    }
  };

  const isTaskCompleted = (t, parentDateStr) => t.routine ? t.completedDates?.includes(parentDateStr) : t.completed;

  const renderTask = (task, parentDateStr, readonly = false) => {
    const completed = isTaskCompleted(task, parentDateStr);

    return (
      <div key={task.id} className="glass-panel" style={{ 
        padding: '1rem 1.5rem', 
        display: 'flex', 
        alignItems: 'flex-start', 
        justifyContent: 'space-between',
        opacity: completed ? 0.6 : 1,
        transform: completed ? 'scale(0.98)' : 'scale(1)',
        marginBottom: '0.5rem',
        background: completed ? 'rgba(255,255,255,0.4)' : 'var(--surface)',
        gap: '0.5rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', cursor: readonly ? 'default' : 'pointer', flex: 1 }} onClick={() => !readonly && toggleTask(task.id, parentDateStr)}>
          {!readonly && (
            <div style={{ 
              minWidth: '24px', height: '24px', borderRadius: '6px', 
              border: '2px solid var(--primary)', 
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: completed ? 'var(--primary)' : 'rgba(255, 255, 255, 0.5)',
              marginTop: '4px'
            }}>
              {completed && <Check size={16} color="white" />}
            </div>
          )}
          <div style={{ 
            textDecoration: completed ? 'line-through' : 'none', 
            color: completed ? 'var(--text-muted)' : 'var(--text-main)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.3rem',
            wordBreak: 'break-word',
            paddingRight: '0.5rem'
          }}>
            <span style={{ fontSize: '1.1rem', lineHeight: '1.4' }}>{task.text}</span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {task.time && (
                <span style={{ fontSize: '0.85rem', color: 'var(--secondary)', display: 'flex', alignItems: 'center', gap: '0.25rem', fontWeight: '500' }}>
                  <Clock size={14} /> 
                  {formatTimeString(task.time)}
                </span>
              )}
              {task.routine && (
                <span style={{ fontSize: '0.75rem', background: 'rgba(244,114,182,0.15)', border: '1px solid rgba(244,114,182,0.5)', padding: '2px 8px', borderRadius: '12px', color: 'var(--primary)', fontWeight: '500' }}>
                  Daily Routine
                </span>
              )}
              {task.gcalSynced && !task.routine && (
                 <span style={{ fontSize: '0.7rem', color: 'var(--success)', border: '1px solid rgba(52,211,153,0.5)', padding: '2px 6px', borderRadius: '8px', fontWeight: '500' }}>
                    Synced
                 </span>
              )}
            </div>
          </div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); handleDeleteTask(task); }} style={{ 
          background: 'rgba(251, 113, 133, 0.05)', border: '1px solid rgba(251, 113, 133, 0.1)', color: 'var(--danger)', 
          cursor: 'pointer', display: 'flex', padding: '0.5rem', borderRadius: '8px', transition: 'all 0.2s',
          minWidth: '38px', justifyContent: 'center'
        }} onMouseOver={e => e.currentTarget.style.background='rgba(251, 113, 133, 0.15)'} onMouseOut={e => e.currentTarget.style.background='rgba(251, 113, 133, 0.05)'}>
          <Trash2 size={18} />
        </button>
      </div>
    );
  };

  const getCalendarDays = () => {
    const currentMonthStart = startOfMonth(new Date());
    const currentMonthEnd = endOfMonth(currentMonthStart);
    const calendarStart = startOfWeek(currentMonthStart, { weekStartsOn: 1 });
    const calendarEnd = endOfWeek(currentMonthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  };

  // Group scheduled items for the mobile Tabular view
  const getGroupedTasks = () => {
    const grouped = {};
    const uncompletedNonRoutines = appData.tasks.filter(t => !t.routine);
    uncompletedNonRoutines.forEach(t => {
      if (!grouped[t.date]) grouped[t.date] = [];
      grouped[t.date].push(t);
    });
    return Object.keys(grouped).sort().map(date => ({ date, tasks: grouped[date] }));
  };

  const todayTasks = appData.tasks.filter(t => t.date === todayStr || t.routine);
  const tomorrowTasks = appData.tasks.filter(t => t.date === tomorrowStr && !t.routine);

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">To-Do & Routines</h1>
          <p className="page-subtitle">Crush your goals and schedule your time.</p>
        </div>
        
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="glass-panel" style={{ display: 'flex', padding: '0.25rem', gap: '0.25rem', borderRadius: '12px' }}>
             <button onClick={() => setView('daily')} className={`btn ${view === 'daily' ? '' : 'btn-secondary'}`} style={{ padding: '0.5rem 1rem' }}>
                <LayoutList size={18} /> Daily
             </button>
             <button onClick={() => setView('monthly')} className={`btn ${view === 'monthly' ? '' : 'btn-secondary'}`} style={{ padding: '0.5rem 1rem' }}>
                <CalendarDays size={18} /> Monthly
             </button>
          </div>
          <button 
            className={`btn ${gcalToken ? 'btn-secondary' : ''}`} 
            onClick={handleConnect} 
            disabled={!!gcalToken || isSyncing}
            style={{ width: '180px' }}
          >
            {gcalToken ? (
              <>
                <Check size={20} className="text-secondary" color="var(--primary)" />
                Connected
              </>
            ) : (
              <>
                <Calendar size={20} className="text-secondary" color="var(--secondary)" />
                Connect Calendar
              </>
            )}
          </button>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input 
            type="text" 
            className="input-field" 
            style={{ flex: '1', minWidth: '200px' }}
            placeholder="Add to your list... (e.g. Call Mom)" 
            value={newTaskText}
            onChange={e => setNewTaskText(e.target.value)}
          />
          <input 
            type="date" 
            className="input-field" 
            style={{ width: '150px' }}
            value={taskDate}
            onChange={e => setTaskDate(e.target.value)}
            disabled={isRoutine}
            title={isRoutine ? "Daily routines apply to every date" : "Select date"}
          />
          <input 
            type="time" 
            className="input-field" 
            style={{ width: '120px' }}
            value={taskTime}
            onChange={e => setTaskTime(e.target.value)}
            title="Set an optional reminder time"
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}>
            <input 
              type="checkbox" 
              checked={isRoutine}
              onChange={e => setIsRoutine(e.target.checked)}
              style={{ width: '18px', height: '18px', accentColor: 'var(--primary)' }}
            />
            Daily Routine
          </label>
          <button type="submit" className="btn">
            <Plus size={20} /> Add
          </button>
        </form>
      </div>

      {view === 'daily' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '2rem' }}>
          <div>
            <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.3rem' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--primary)', boxShadow: '0 0 10px var(--primary-glow)' }}></div>
              Today's Target
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {todayTasks.map(t => renderTask(t, todayStr, false))}
              {todayTasks.length === 0 && <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>All caught up!</div>}
            </div>
          </div>

          <div>
             <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.3rem' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--warning)', boxShadow: '0 0 10px rgba(245, 158, 11, 0.4)' }}></div>
              Tomorrow
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
               {tomorrowTasks.map(t => renderTask(t, tomorrowStr, false))}
               {tomorrowTasks.length === 0 && <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No tasks scheduled.</div>}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Desktop Grid View */}
          <div className="desktop-only glass-panel" style={{ padding: '2rem' }}>
            <h3 style={{ marginBottom: '2rem', fontSize: '1.5rem' }}>{format(new Date(), 'MMMM yyyy')}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1rem' }}>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                <div key={d} style={{ textAlign: 'center', color: 'var(--text-muted)', fontWeight: 'bold' }}>{d}</div>
              ))}
              
              {getCalendarDays().map(day => {
                const dStr = format(day, 'yyyy-MM-dd');
                const dTasks = appData.tasks.filter(t => t.date === dStr && !t.routine);
                const isCurrMonth = isSameMonth(day, new Date());
                const isTo = isToday(day);
                
                return (
                  <div key={dStr} style={{ 
                    background: isTo ? 'rgba(244, 114, 182, 0.15)' : 'rgba(255,255,255,0.5)', 
                    border: isTo ? '1px solid var(--primary)' : '1px solid var(--surface-border)',
                    borderRadius: '12px', 
                    minHeight: '100px', 
                    padding: '0.5rem',
                    opacity: isCurrMonth ? 1 : 0.4
                  }}>
                    <div style={{ textAlign: 'right', fontSize: '0.8rem', color: isTo ? 'var(--primary)' : 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: isTo ? 'bold' : 'normal' }}>
                      {format(day, 'd')}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {dTasks.map(t => (
                        <div key={t.id} style={{ 
                          fontSize: '0.7rem', 
                          padding: '2px 6px', 
                          background: t.completed ? 'transparent' : 'rgba(244,114,182,0.2)', 
                          border: t.completed ? '1px solid var(--text-muted)' : 'none',
                          color: t.completed ? 'var(--text-muted)' : 'var(--text-main)',
                          borderRadius: '4px',
                          textDecoration: t.completed ? 'line-through' : 'none',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '4px'
                        }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.text}</span>
                          {t.time && <span style={{ fontSize: '0.6rem', color: 'var(--secondary)' }}>{formatTimeString(t.time)}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          
          {/* Mobile Tabular View */}
          <div className="mobile-only glass-panel" style={{ padding: '1.5rem', marginBottom: '1rem' }}>
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
               <CalendarDays size={20} color="var(--primary)" /> Calendar Agenda
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
               {getGroupedTasks().length === 0 && (
                 <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>It's quiet... no upcoming tasks scheduled!</div>
               )}
               {getGroupedTasks().map(group => (
                  <div key={group.date}>
                     <h4 style={{ color: 'var(--secondary)', marginBottom: '0.75rem', borderBottom: '2px solid rgba(192, 132, 252, 0.15)', paddingBottom: '0.5rem', fontSize: '1.1rem' }}>
                       {format(new Date(group.date), 'EEEE, MMM do yyyy')}
                     </h4>
                     <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                       {group.tasks.map(t => renderTask(t, group.date, false))}
                     </div>
                  </div>
               ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
export default ToDo;
