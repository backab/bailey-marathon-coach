// --- STATE & DATABASE ---
let currentMonth = 1; // Start in February 2026 (0=Jan, 1=Feb)
let currentYear = 2026;
let selectedWorkoutId = null;
let workouts = [];
let weatherData = { daily: {}, hourly: {} }; 
let mileageChartInstance = null; // Holds the chart

const getLocalTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

document.addEventListener("DOMContentLoaded", () => {
  const savedData = localStorage.getItem('baileyCoachData_v2');
  if (savedData) {
    workouts = JSON.parse(savedData);
  } else {
    workouts = generateWorkouts();
  }
  
  fetchWeather(); 
  updateWidgets();
  renderDashboard();
  renderCalendar();
  renderChart(); // Render the mileage graph
});

// --- DYNAMIC MILEAGE CHART LOGIC ---
function renderChart() {
  const ctx = document.getElementById('mileageChart');
  if (!ctx) return;

  const weeklyData = {};
  const todayStr = getLocalTodayStr();

  // Group workouts into Weekly Buckets
  workouts.forEach(w => {
    // Safely parse date to avoid timezone shifts
    const [y, m, d] = w.date.split('-');
    const dateObj = new Date(y, m - 1, d);
    const dayOfWeek = dateObj.getDay(); // 0 = Sunday
    
    // Find the Sunday that started this week
    const sunday = new Date(dateObj);
    sunday.setDate(dateObj.getDate() - dayOfWeek);
    
    const sundayStr = `${sunday.getFullYear()}-${String(sunday.getMonth()+1).padStart(2,'0')}-${String(sunday.getDate()).padStart(2,'0')}`;
    const shortLabel = `${sunday.getMonth()+1}/${sunday.getDate()}`; // e.g., "2/1"

    if (!weeklyData[sundayStr]) {
      weeklyData[sundayStr] = { label: shortLabel, achieved: 0, future: 0, sortKey: sundayStr };
    }

    const actual = parseFloat(w.actualMiles) || 0;
    const planned = parseFloat(w.plannedMiles) || 0;

    // Stack Logic: 
    // If run is logged, add to achieved. 
    // If run is NOT logged and is in the future, add to planned/future.
    // If run is NOT logged and is in the past, it counts as a missed workout (0 miles).
    if (w.actualMiles !== '') {
        weeklyData[sundayStr].achieved += actual;
    } else if (w.date >= todayStr) {
        weeklyData[sundayStr].future += planned;
    }
  });

  // Sort chronologically
  const sortedWeeks = Object.values(weeklyData).sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const labels = sortedWeeks.map(w => w.label);
  const achievedData = sortedWeeks.map(w => w.achieved);
  const futureData = sortedWeeks.map(w => w.future);

  // Destroy old chart if updating
  if (mileageChartInstance) {
      mileageChartInstance.destroy();
  }

  // Paint the new stacked bar chart
  mileageChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
          labels: labels,
          datasets: [
              {
                  label: 'Achieved Miles',
                  data: achievedData,
                  backgroundColor: '#26A69A', // Solid, 100% Opaque Teal
                  borderRadius: 4,
                  stack: 'Stack 0'
              },
              {
                  label: 'Planned Miles',
                  data: futureData,
                  backgroundColor: 'rgba(38, 166, 154, 0.3)', // Faded, 30% Opaque Teal
                  borderRadius: 4,
                  stack: 'Stack 0'
              }
          ]
      },
      options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
              legend: {
                  display: true,
                  position: 'top',
                  labels: { boxWidth: 12, font: { family: "'Inter', sans-serif", size: 10 } }
              },
              tooltip: {
                  callbacks: { label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(1)} mi` }
              }
          },
          scales: {
              x: { stacked: true, grid: { display: false }, ticks: { font: { family: "'Inter', sans-serif", size: 10 } } },
              y: { stacked: true, beginAtZero: true, border: { display: false }, ticks: { font: { family: "'Inter', sans-serif", size: 10 } } }
          }
      }
  });
}

// --- ENHANCED WEATHER API ---
async function fetchWeather() {
  try {
    const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=47.16&longitude=-122.51&daily=temperature_2m_max,precipitation_probability_max,weathercode&hourly=temperature_2m,precipitation_probability&timezone=America%2FLos_Angeles');
    const data = await response.json();
    
    data.daily.time.forEach((date, index) => {
      let icon = "☀️";
      if (data.daily.precipitation_probability_max[index] > 50) icon = "🌧️";
      else if (data.daily.weathercode[index] >= 3) icon = "☁️";
      weatherData.daily[date] = { temp: Math.round((data.daily.temperature_2m_max[index] * 9/5) + 32), icon: icon };
    });

    data.hourly.time.forEach((timeStr, index) => {
      const datePart = timeStr.split('T')[0];
      const hourPart = timeStr.split('T')[1];
      if (!weatherData.hourly[datePart]) weatherData.hourly[datePart] = [];
      weatherData.hourly[datePart].push({
        time: hourPart, temp: Math.round((data.hourly.temperature_2m[index] * 9/5) + 32), precip: data.hourly.precipitation_probability[index]
      });
    });
    renderDashboard(); 
  } catch (e) { console.log("Weather fetch failed."); }
}

function findBestTime() {
  if (!selectedWorkoutId) return;
  const w = workouts.find(wo => wo.id === selectedWorkoutId);
  const dateStr = w.date;
  const resultBox = document.getElementById('best-time-result');

  if (!weatherData.hourly || !weatherData.hourly[dateStr]) {
    resultBox.innerHTML = "<i>Weather data unavailable (Forecasts only go 7 days out).</i>";
    return;
  }

  let durationMins = 45; 
  if (w.plannedMiles > 0) durationMins = w.plannedMiles * 8.5;
  else if (w.type === 'Cross-Train') durationMins = 60; 

  const hours = weatherData.hourly[dateStr];
  let bestHour = null;
  let bestScore = Infinity;

  for (let i = 6; i <= 18; i++) {
     let hourData = hours[i];
     if(!hourData) continue;
     let score = (hourData.precip * 2) + Math.abs(hourData.temp - 50);
     if (score < bestScore) { bestScore = score; bestHour = hourData; }
  }

  if (bestHour) {
    let hourInt = parseInt(bestHour.time.split(':')[0]);
    let ampm = hourInt >= 12 ? 'PM' : 'AM';
    let displayHour = hourInt % 12 || 12;
    resultBox.innerHTML = `
      <div style="margin-top: 8px;">
        ⏱️ Est. Duration: <b>${Math.round(durationMins)} mins</b><br>
        🎯 Optimal Start: <b>${displayHour}:00 ${ampm}</b><br>
        🌡️ Conditions: ${bestHour.temp}°F, ${bestHour.precip}% rain chance
      </div>`;
  }
}

// --- CORE GENERATOR ---
function generateWorkouts() {
  const generated = [];
  const startDate = new Date(2026, 1, 1); // FEB 1
  const endDate = new Date(2026, 7, 31); // AUG 31
  let idCounter = 1;

  const speedProgression = ["8x400m", "4x1200m", "6x800m", "3x1600m", "10x400m", "5x1200m", "7x800m", "3x1600m", "12x400m", "8x800m", "4x1600m", "12x400m", "6x1200m", "7x800m", "3x1600m", "5x1000m", "Yasso 800s (8x)", "Yasso 800s (10x)", "4x1200m", "Fartlek", "Shakeout"];
  const tempoProgression = ["Short Tempo", "Mid Tempo", "Mid Tempo", "Short Tempo", "Mid Tempo", "Mid Tempo", "Long Tempo", "Long Tempo", "Short Tempo", "Mid Tempo", "Long Tempo", "Mid Tempo", "Mid Tempo", "Short Tempo", "Long Tempo", "Long Tempo", "Long Tempo", "Marathon Pace", "Mid Tempo", "Short Tempo", "Race Week Tempo"];
  
  const saturdayLongRuns = {
    '2026-02-07': 8, '2026-02-14': 10, '2026-02-21': 8, '2026-02-28': 10,
    '2026-03-07': 12, '2026-03-14': 5, '2026-03-21': 13, '2026-03-28': 14,
    '2026-04-04': 15, '2026-04-11': 10, '2026-04-18': 16, '2026-04-25': 8,
    '2026-05-02': 13.1, '2026-05-09': 10, '2026-05-16': 14, '2026-05-23': 16,
    '2026-05-30': 18, '2026-06-06': 14, '2026-06-13': 20, '2026-06-20': 16,
    '2026-06-27': 22, '2026-07-04': 20, '2026-07-11': 12, '2026-07-18': 6,
    '2026-07-25': 26.2
  };

  const marchFirst = new Date(2026, 2, 1);

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const dayOfWeek = d.getDay(); 
    
    let weekIndex = Math.floor((d.getTime() - marchFirst.getTime()) / (7 * 86400000));
    if (weekIndex < 0) weekIndex = 0; 
    weekIndex = Math.min(weekIndex, speedProgression.length - 1);
    
    const currentSat = new Date(d);
    currentSat.setDate(d.getDate() + (6 - dayOfWeek));
    const satStr = `${currentSat.getFullYear()}-${String(currentSat.getMonth() + 1).padStart(2, '0')}-${String(currentSat.getDate()).padStart(2, '0')}`;
    const thisWeeksLR = saturdayLongRuns[satStr] || 8; 

    const wedEasyMiles = Math.max(4, Math.floor(thisWeeksLR * 0.35)); 
    const friEasyMiles = Math.max(3, Math.floor(thisWeeksLR * 0.25)); 

    let type = 'Recovery', title = 'Easy Run', plannedMiles = 5, plannedPace = '8:00/mi', desc = 'Keep it conversational.';
    
    if (dayOfWeek === 1) { type = 'Cross-Train'; title = 'Rock Climb + Pre-Hab'; plannedMiles = 0; plannedPace = 'N/A'; desc = 'Climbing session + 15 mins dumbbell work.'; }
    else if (dayOfWeek === 2) { type = 'Speed'; title = speedProgression[weekIndex]; plannedMiles = 6; plannedPace = 'See Calc'; desc = 'Hills or track intervals.'; }
    else if (dayOfWeek === 3) { type = 'Recovery'; title = 'Mid-Week Easy'; plannedMiles = wedEasyMiles; plannedPace = '8:00/mi'; desc = 'Strictly easy.'; }
    else if (dayOfWeek === 4) { type = 'Tempo'; title = tempoProgression[weekIndex]; plannedMiles = 7; plannedPace = 'See Calc'; desc = 'Lactate threshold effort.'; }
    else if (dayOfWeek === 5) { type = 'Recovery'; title = 'Easy Run'; plannedMiles = friEasyMiles; plannedPace = '8:00/mi'; desc = 'Shakeout.'; }
    else if (dayOfWeek === 6) { 
      type = 'Long'; title = 'Long Run'; plannedMiles = thisWeeksLR; plannedPace = '7:45/mi'; desc = 'Aerobic development.';
      if (dateStr === '2026-05-02') { title = '🏁 TACOMA HM'; plannedPace = 'Race Pace'; desc = 'Sub-1:25 attempt.'; }
      if (dateStr === '2026-07-25') { title = '🏁 JACK & JILL MARATHON'; plannedPace = '6:50/mi'; desc = 'Sub-3 Attempt.'; }
    } 
    else if (dayOfWeek === 0) { type = 'Rest'; title = 'Full Rest'; plannedMiles = 0; plannedPace = 'N/A'; desc = 'Zero impact.'; }

    if (dateStr >= '2026-03-13' && dateStr <= '2026-03-17' && dayOfWeek !== 6) { type = 'Rest'; title = 'Travel Day'; plannedMiles = 0; }
    if (dateStr >= '2026-07-12' && dateStr <= '2026-07-18' && dayOfWeek !== 6) { type = dayOfWeek === 3 ? 'Recovery' : 'Rest'; title = dayOfWeek === 3 ? 'Shakeout' : 'Travel Taper'; }
    if (dateStr > '2026-07-25') {
      if (dayOfWeek === 1 || dayOfWeek === 5) { type = 'Cross-Train'; title = 'Light Climb / Walk'; plannedMiles = 0; plannedPace = 'N/A'; desc = 'Active recovery.'; }
      else { type = 'Rest'; title = 'Recovery Block'; plannedMiles = 0; plannedPace = 'N/A'; desc = 'Post-marathon healing.'; }
    }

    generated.push({ id: idCounter++, date: dateStr, type: type, title: title, plannedMiles: plannedMiles, plannedPace: plannedPace, actualMiles: '', actualPace: '', actualElev: '', actualGap: '', description: desc, notes: '' });
  }
  return generated;
}

function updateWidgets() {
  let totalShoeMiles = 0;
  let hardMiles = 0;
  let easyMiles = 0;

  workouts.forEach(w => {
    let m = parseFloat(w.actualMiles) || 0;
    totalShoeMiles += m;
    if (w.type === 'Speed' || w.type === 'Tempo') hardMiles += m;
    if (w.type === 'Recovery' || w.type === 'Long') easyMiles += m;
  });

  document.getElementById('shoe-text').innerText = `${totalShoeMiles.toFixed(1)} / 350 mi`;
  let shoePercent = Math.min((totalShoeMiles / 350) * 100, 100);
  let shoeBar = document.getElementById('shoe-bar');
  shoeBar.style.width = `${shoePercent}%`;
  if (totalShoeMiles > 250) shoeBar.style.background = "#F59E0B"; 
  if (totalShoeMiles > 320) shoeBar.style.background = "#D81B60"; 

  let totalRunning = hardMiles + easyMiles;
  if (totalRunning > 0) {
    let easyPercent = Math.round((easyMiles / totalRunning) * 100);
    let hardPercent = 100 - easyPercent;
    document.getElementById('easy-bar').style.width = `${easyPercent}%`;
    document.getElementById('hard-bar').style.width = `${hardPercent}%`;
    document.getElementById('easy-text').innerText = `Easy: ${easyPercent}%`;
    document.getElementById('hard-text').innerText = `Hard: ${hardPercent}%`;
  }

  const today = new Date(getLocalTodayStr());
  const tacomaDate = new Date('2026-05-02');
  const jjDate = new Date('2026-07-25');
  const tacomaDays = Math.ceil((tacomaDate - today) / (1000 * 60 * 60 * 24));
  const jjDays = Math.ceil((jjDate - today) / (1000 * 60 * 60 * 24));
  document.getElementById('tacoma-countdown').innerText = tacomaDays > 0 ? `${tacomaDays} Days` : "Passed";
  document.getElementById('jj-countdown').innerText = jjDays > 0 ? `${jjDays} Days` : "Passed";
}

function renderDashboard() {
  const container = document.getElementById('upcoming-workouts');
  if(!container) return; 
  container.innerHTML = '';
  
  const todayStr = getLocalTodayStr(); 
  const upcoming = workouts.filter(w => w.date >= todayStr).slice(0, 10); 
  
  upcoming.forEach(w => {
    let statusHTML = w.actualMiles ? `<span style="color:#26A69A;">Done: ${w.actualMiles} mi @ ${w.actualPace}</span>` : `Planned: ${w.plannedMiles} mi`;
    let icon = w.type === 'Cross-Train' ? '🧗' : (w.type === 'Rest' ? '🛌' : '🏃');
    if (w.title.includes('🏁')) icon = '🏅';
    
    let titleHTML = w.isAltered ? `<span style="color:#D81B60; font-weight:700;">[AI]</span> ${w.title}` : w.title;
    let weatherHTML = weatherData.daily[w.date] ? `<span class="w-weather">${weatherData.daily[w.date].icon} ${weatherData.daily[w.date].temp}°F</span>` : '';
    
    let metricsHTML = '';
    if (w.actualElev && w.actualGap) {
      metricsHTML = `<div class="w-metrics"><span style="color:#94A3B8;">Elev: ${w.actualElev}ft</span> <span class="w-gap">GAP: ${w.actualGap}/mi</span></div>`;
    }
    let notesHTML = w.notes ? `<span class="w-notes" style="font-size: 11px; color: #94A3B8; margin-top: 5px; font-style: italic; display: block;">📝 "${w.notes}"</span>` : '';

    container.innerHTML += `
      <div class="workout-row" onclick="openModal(${w.id})">
        <div class="w-icon ${w.title.includes('🏁') ? 'gold-bg' : 'purple-bg'}">${icon}</div>
        <div class="w-details">
          <div style="font-size:10px; color:#94A3B8; font-weight: 700; margin-bottom: 2px;">${w.date} ${weatherHTML}</div>
          ${titleHTML}
          ${metricsHTML}
          ${notesHTML}
        </div>
        <div class="w-status">${statusHTML}</div>
      </div>
    `;
  });
}

function changeMonth(dir) {
  currentMonth += dir;
  if(currentMonth > 11) { currentMonth = 0; currentYear++; }
  if(currentMonth < 0) { currentMonth = 11; currentYear--; }
  renderCalendar();
}

function renderCalendar() {
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const headerText = document.getElementById('calendar-month-year');
  if(headerText) headerText.innerText = `${monthNames[currentMonth]} ${currentYear}`;
  
  const grid = document.getElementById('calendar-grid');
  if(!grid) return; 
  grid.innerHTML = '';
  
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  
  for(let i = 0; i < firstDay; i++) { grid.innerHTML += `<div class="calendar-day" style="background: transparent; border: none; box-shadow: none;"></div>`; }
  
  for(let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const w = workouts.find(wo => wo.date === dateStr);
    let contentHTML = ''; let completedClass = '';
    
    if(w) {
      let displayMiles = w.actualMiles ? `${w.actualMiles}mi` : (w.plannedMiles > 0 ? `${w.plannedMiles}mi` : w.type);
      if(w.actualMiles) completedClass = 'cal-completed';
      if(w.title.includes('🏁')) completedClass = 'cal-race';
      let titleHTML = w.isAltered ? `⚠️ ${w.title}` : w.title;

      contentHTML = `<div class="cal-workout-title">${titleHTML}</div><div class="cal-workout-details">${displayMiles}</div>`;
    }
    grid.innerHTML += `<div class="calendar-day ${completedClass}" ${w ? `onclick="openModal(${w.id})"` : ''}><div class="day-number">${day}</div>${contentHTML}</div>`;
  }
}

function openModal(id) {
  selectedWorkoutId = id;
  const w = workouts.find(wo => wo.id === id);
  
  document.getElementById('modalTitle').innerText = `${w.date} - ${w.type}`;
  document.getElementById('modalPlanned').innerText = `Planned: ${w.title} (${w.plannedMiles} mi @ ${w.plannedPace})`;
  document.getElementById('modalDescription').innerText = w.description;
  
  document.getElementById('actualMiles').value = w.actualMiles || '';
  document.getElementById('actualPace').value = w.actualPace || '';
  document.getElementById('actualElev').value = w.actualElev || '';
  document.getElementById('actualGap').value = w.actualGap || '';
  document.getElementById('actualNotes').value = w.notes || '';
  
  const weatherContainer = document.getElementById('smart-weather-container');
  const resultBox = document.getElementById('best-time-result');
  resultBox.innerHTML = ''; 
  if (weatherData.hourly && weatherData.hourly[w.date]) {
    weatherContainer.style.display = 'block';
  } else {
    weatherContainer.style.display = 'none';
  }

  document.getElementById('actualPace').addEventListener('input', calculateGAP);
  document.getElementById('actualElev').addEventListener('input', calculateGAP);
  document.getElementById('actualMiles').addEventListener('input', calculateGAP);

  document.getElementById('workoutModal').style.display = 'flex';
}

function calculateGAP() {
  const miles = parseFloat(document.getElementById('actualMiles').value);
  const paceStr = document.getElementById('actualPace').value;
  const elevFt = parseFloat(document.getElementById('actualElev').value);

  if (miles > 0 && paceStr && elevFt > 0 && paceStr.includes(':')) {
    const parts = paceStr.split(':');
    const rawSeconds = (parseInt(parts[0]) * 60) + parseInt(parts[1]);
    const elevPerMile = elevFt / miles;
    const gapAdjustmentSeconds = (elevPerMile / 100) * 15;
    
    let gapSeconds = rawSeconds - gapAdjustmentSeconds;
    if (gapSeconds < 0) gapSeconds = rawSeconds; 
    
    const m = Math.floor(gapSeconds / 60);
    const s = Math.floor(gapSeconds % 60).toString().padStart(2, '0');
    document.getElementById('actualGap').value = `${m}:${s}`;
  } else {
    document.getElementById('actualGap').value = '';
  }
}

function closeModal() { document.getElementById('workoutModal').style.display = 'none'; selectedWorkoutId = null; }

function saveWorkout() {
  if(!selectedWorkoutId) return;
  const w = workouts.find(wo => wo.id === selectedWorkoutId);
  w.actualMiles = document.getElementById('actualMiles').value;
  w.actualPace = document.getElementById('actualPace').value;
  w.actualElev = document.getElementById('actualElev').value;
  w.actualGap = document.getElementById('actualGap').value;
  w.notes = document.getElementById('actualNotes').value;
  
  saveToCloud();
  closeModal(); 
  updateWidgets();
  renderDashboard(); 
  renderCalendar(); 
  renderChart(); // Re-render the graph when data is saved!
}

// --- NAVIGATION LOGIC ---
// 1. UPGRADED SWITCH TAB
function switchTab(event, tabId) {
  if (event) event.preventDefault();

  const tabs = document.querySelectorAll('.tab-content');
  tabs.forEach(tab => tab.style.display = 'none');

  const navLinks = document.querySelectorAll('.nav-menu a');
  navLinks.forEach(link => link.classList.remove('active'));

  document.getElementById(tabId).style.display = 'block';

  if (event && event.currentTarget) {
    event.currentTarget.classList.add('active');
  } else {
    const activeLink = document.querySelector(`.nav-menu a[onclick*="${tabId}"]`);
    if (activeLink) activeLink.classList.add('active');
  }

  // 👇 THE FINAL CLEANUP: Auto-load the most recent run 👇
  if (tabId === 'lastrun-view') {
    renderDeepDive(); // Calling it with nothing inside defaults to the newest run
  }
}

function calculatePaces() {
  const distSelect = parseFloat(document.getElementById('raceDist').value);
  const mins = parseInt(document.getElementById('raceMin').value) || 0;
  const secs = parseInt(document.getElementById('raceSec').value) || 0;
  const totalSeconds = (mins * 60) + secs;
  
  let estimated10kSecs = totalSeconds;
  if(distSelect === 1) estimated10kSecs = totalSeconds * 6.5;
  if(distSelect === 3.1) estimated10kSecs = totalSeconds * 2.08;
  if(distSelect === 10) estimated10kSecs = totalSeconds / 1.65;
  if(distSelect === 13.1) estimated10kSecs = totalSeconds / 2.2;
  if(distSelect === 26.2) estimated10kSecs = totalSeconds / 4.6;

  const pacePerMileSecs = estimated10kSecs / 6.21;
  const formatPace = (sec) => { const m = Math.floor(sec / 60); const s = Math.floor(sec % 60).toString().padStart(2, '0'); return `${m}:${s}`; };

  document.getElementById('calcLong').innerText = `${formatPace(pacePerMileSecs + 60)} - ${formatPace(pacePerMileSecs + 75)} /mi`;
  document.getElementById('calcTempo').innerText = `${formatPace(pacePerMileSecs + 0)} - ${formatPace(pacePerMileSecs + 35)} /mi`;
  document.getElementById('calcSpeed').innerText = `${formatPace(pacePerMileSecs - 60)} - ${formatPace(pacePerMileSecs - 35)} /mi`;
}

function generatePlan() {
  const jointScore = parseInt(document.getElementById("jointScore").value);
  const rpeScore = parseInt(document.getElementById("rpeScore").value);
  const feedbackBox = document.getElementById("coachFeedback");
  let modifications = [];

  const todayStr = getLocalTodayStr();
  const upcomingWeek = workouts.filter(w => w.date >= todayStr).slice(0, 7);

  upcomingWeek.forEach(w => {
    if (w.originalTitle === undefined) {
      w.originalTitle = w.title; w.originalMiles = w.plannedMiles; w.originalPace = w.plannedPace; w.originalType = w.type; w.originalDesc = w.description;
    }
    w.title = w.originalTitle; w.plannedMiles = w.originalMiles; w.plannedPace = w.originalPace; w.type = w.originalType; w.description = w.originalDesc; w.isAltered = false;

    if (jointScore >= 5) {
      if (w.type === 'Speed' || w.type === 'Tempo') {
        w.type = 'Cross-Train'; w.title = `Converted from ${w.originalTitle}`; w.plannedMiles = 0; w.plannedPace = 'N/A';
        w.isAltered = true;
      }
      if (w.type === 'Long' && !w.title.includes('🏁')) {
         w.plannedMiles = Math.round(w.originalMiles * 0.7); w.title = `${w.originalTitle} (Reduced)`;
         w.isAltered = true;
      }
    } else if (rpeScore >= 5) {
      if (w.type === 'Recovery' || (w.type === 'Long' && !w.title.includes('🏁'))) {
         w.plannedPace = w.originalPace + " (+30s/mi)"; w.title = `${w.originalTitle} (Slowed Down)`;
         w.isAltered = true;
      }
    }
  });

  localStorage.setItem('baileyCoachData_v2', JSON.stringify(workouts));
  renderDashboard(); renderCalendar(); renderChart();
  if (jointScore >= 5) feedbackBox.innerHTML = `⚠️ <b>Joint score ${jointScore}.</b> Volume reduced.`;
  else if (rpeScore >= 5) feedbackBox.innerHTML = `🏃 <b>RPE is ${rpeScore}.</b> Paces slowed.`;
  else feedbackBox.innerHTML = `✅ <b>Green light!</b> Plan locked.`;
}

// ==========================================
// MAPPING & ROUTE REPOSITORY LOGIC
// ==========================================

// Global variable to hold our active map instance
let activeMap = null;

// The Local Route Database
const routeRepository = [
  {
    name: "Fort Steilacoom Park Outer Loop",
    distance: "3.2 miles",
    type: "Trail / Gravel",
    tags: ["Door-to-door", "Hills", "Park"],
    // Real Polyline for Steilacoom Park
    polyline: "e|saHtw{iVm@`@}@j@SJi@P]RUXWb@A~@I\\E`@EXC^Db@Hj@?^Bf@`@xATd@V^d@~@l@lAh@hARV`@TZRd@l@n@z@|@vB^|@f@z@h@hAfAbCZr@fAlCv@jBhA`C\\~@Rf@d@hA|@tBXl@Vx@^rAVx@@\\J|@Ht@D`@@Z?TCJEXGTCJCZIX?\\@VFTDPBPHh@FNNj@Hb@@VAXEVK`@Yx@OXUf@]p@_@r@Ud@S`@MXA`@LNZTf@r@xBp@hBZfARv@TfA~@xCDVDd@Ab@K`AET?NBPFRNNL^j@Vb@L\\Dn@?r@IjAKnB?|@DVLhAFp@J|@\\fCNnAT|AHt@Jj@\\vAJf@D|@@h@E`ASlBMdBEt@A|@Bn@LjAHv@FtA`@pDFbALhALr@@f@Ah@IhAMjAUzAGd@Gf@En@A^Bt@Lr@Fj@Dd@`@`C\\zBJhA?lAEt@K`AOtAOpAGz@An@Dv@N`AJ|@FpA\\rBBb@?nAGvAItAK~A?tA@bADv@Lx@?t@C`AIvAMzACjB"
  },
  {
    name: "Chambers Bay - Grandview Trail",
    distance: "3.5 miles",
    type: "Paved Trail",
    tags: ["Views", "Waterfront", "Hills"],
    // Real Polyline for Chambers Bay
    polyline: "g|qaH|l_jV]l@m@bBSl@e@tAQ^I`@A\\?|@DtATlCBhA?jAIhASzBMjBGvAEf@Cb@I`@Qn@i@|AcAfCUv@m@xAYh@k@~Ak@|AMXERARBbAPhCHrBAtAMlBQ|AWbBUnAQpAEf@C`AIfAOdAQl@k@zAg@vAOf@c@xAMZKVCPDfARfCFrA?`AItAShBQ|AU~AM`AEv@Cz@IdAQj@k@zAg@xAQj@e@vAEZAR@bATzC?|@ItAS`B]pCWlBMjBEtAC`AIfASfAi@|Ac@zAYx@a@xAA^@dATxCHtA?~@K|AUhBSrAWzAS|AGpAEpACnAGbAOlA]vAa@xAYx@a@tA"
  },
  {
    name: "Point Defiance Five Mile Drive",
    distance: "5.0 miles",
    type: "Road / Old Growth",
    tags: ["Beautiful Road", "Park", "Shaded"],
    // Real Polyline for Point Defiance
    polyline: "codaH~{hjVc@|AI\\Ah@?p@HlCFtA?fAItAS`BU|AUxAM`AEdACv@IlAQj@i@zAe@zAM`A[vAA\\BnARdCDxAA|@InASbB[~BYtBKtBErAC|@IdAQfAi@xAc@zAMjA[vAA\\BhARdCD~AA|@InASfBWvBWzAMjACxACz@IlAQn@k@zAc@zAMhA[tAE\\BhAT`C?|A"
  }
];

// Strava provides routes as compressed encoded strings. This translates it to map coordinates.
function decodePolyline(str, precision) {
    var index = 0, lat = 0, lng = 0, coordinates = [], shift = 0, result = 0, byte = null, latitude_change, longitude_change, factor = Math.pow(10, precision !== undefined ? precision : 5);
    while (index < str.length) {
        byte = null; shift = 0; result = 0;
        do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
        latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
        shift = result = 0;
        do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
        longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += latitude_change; lng += longitude_change;
        coordinates.push([lat / factor, lng / factor]);
    }
    return coordinates;
}

// Universal map renderer using OpenTopoMap (Includes Trails & Topo lines!)
function renderMap(containerId, polylineString) {
  const container = document.getElementById(containerId);
  container.style.display = 'block';

  // Destroy previous map instance if it exists so we don't get overlap errors
  if (activeMap) { activeMap.remove(); }

  activeMap = L.map(containerId);

  // OpenTopoMap for trail visibility and elevation lines
  L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap'
  }).addTo(activeMap);

  if (polylineString) {
    const coordinates = decodePolyline(polylineString);
    const polyline = L.polyline(coordinates, {color: '#D81B60', weight: 4, opacity: 0.8}).addTo(activeMap);
    activeMap.fitBounds(polyline.getBounds(), { padding: [20, 20] });
  }
}

// Button Logic: Suggest a Route
// Upgraded: Smart Route Matching
function suggestLocalRoute() {
  // 1. Extract the planned distance from the text in the modal
  const plannedText = document.getElementById('modalPlanned').innerText;
  
  // This clever regex pulls just the numbers out of the string (e.g., "Planned: 5.0 miles" -> 5.0)
  const distanceMatch = plannedText.match(/[\d\.]+/);
  const targetDistance = distanceMatch ? parseFloat(distanceMatch[0]) : 0;

  let bestRoute = routeRepository[0];

  // 2. Find the route in the repository with the closest matching distance
  if (targetDistance > 0) {
    let smallestDiff = Infinity;
    routeRepository.forEach(route => {
      const routeDist = parseFloat(route.distance);
      const diff = Math.abs(routeDist - targetDistance);
      
      // If this route's distance is closer to our target, make it the new best route
      if (diff < smallestDiff) {
        smallestDiff = diff;
        bestRoute = route;
      }
    });
  } else {
    // Fallback: Pick a random route if no planned distance exists
    bestRoute = routeRepository[Math.floor(Math.random() * routeRepository.length)];
  }

  // 3. Render the matched route
  document.getElementById('suggested-route-info').innerHTML = `
    Suggested: ${bestRoute.name} (${bestRoute.distance}) <br>
    <span style="font-weight:normal; color:#64748B;">Type: ${bestRoute.type} | Tags: ${bestRoute.tags.join(', ')}</span>
  `;
  
  setTimeout(() => {
    renderMap('modal-map', bestRoute.polyline);
  }, 100);
}

// Logic: Last Run Deep Dive Tab
// Navigates from the modal directly to the specific day's deep dive
// Navigates from the modal directly to the specific day's deep dive
function goToDeepDive() {
  // Create a custom flag so switchTab knows we are coming from the modal
  const customEvent = new Event('click');
  customEvent.isFromModal = true;

  // Grab the exact workout using the secret ID we just found!
  const currentWorkout = workouts.find(wo => wo.id === selectedWorkoutId);

  closeModal(); 
  switchTab(customEvent, 'lastrun-view'); 
  
  // Pass the exact date to the deep dive renderer
  if (currentWorkout && currentWorkout.date) {
    renderDeepDive(currentWorkout.date);
  } else {
    renderDeepDive(); // Fallback just in case
  }
}

// Upgraded Deep Dive Logic (Accepts specific dates)
function renderDeepDive(targetDate = null) {
  let targetWorkout = null;

  if (targetDate) {
    // If a date was clicked from the calendar, find that specific run
    targetWorkout = workouts.find(w => w.date === targetDate);
  } else {
    // Fallback: If clicking the sidebar tab directly, just show the most recent completed run
    const completedRuns = workouts.filter(w => w.actualMiles);
    if (completedRuns.length > 0) {
      completedRuns.sort((a, b) => new Date(b.date) - new Date(a.date));
      targetWorkout = completedRuns[0];
    }
  }

  // Handle empty days
  if (!targetWorkout || !targetWorkout.actualMiles) {
    document.getElementById('last-run-stats').innerHTML = `<p style="color:#64748B; font-style: italic;">No GPS data recorded for this selection yet.</p>`;
    document.getElementById('last-run-map').style.display = 'none';
    return;
  }

  // Render the specific day's data
  document.getElementById('last-run-map').style.display = 'block';
  const statsHtml = `
    <div class="widget-box" style="flex:1;"><h3>Distance</h3><p style="font-size:24px; color:#D81B60; font-weight:bold;">${targetWorkout.actualMiles} mi</p></div>
    <div class="widget-box" style="flex:1;"><h3>Avg Pace</h3><p style="font-size:24px; color:#26A69A; font-weight:bold;">${targetWorkout.actualPace} /mi</p></div>
    <div class="widget-box" style="flex:1;"><h3>Elevation</h3><p style="font-size:24px; color:#F59E0B; font-weight:bold;">${targetWorkout.actualElev} ft</p></div>
  `;
  document.getElementById('last-run-stats').innerHTML = statsHtml;

  // Use the actual Strava polyline for that day if it exists, otherwise show a generic route
  renderMap('last-run-map', targetWorkout.mapPolyline || routeRepository[0].polyline); 
}


// Logic: Render the 100-Route Repository Tab
function renderSuggestedRoutes() {
  const grid = document.getElementById('route-repository-grid');
  grid.innerHTML = '';
  
  routeRepository.forEach(route => {
    grid.innerHTML += `
      <div class="widget-box">
        <h4 style="color:#0D2B5A; margin-bottom:5px;">${route.name}</h4>
        <p style="color:#D81B60; font-weight:bold; margin-bottom:5px;">${route.distance}</p>
        <p style="font-size:12px; color:#64748B;">${route.tags.join(' • ')}</p>
      </div>
    `;
  });
}

// --- CLOUDFLARE BACKEND STRAVA SYNC ---
// --- CLOUDFLARE BACKEND STRAVA SYNC ---
async function syncStrava() {
  try {
    const response = await fetch('/api/strava'); 
    
    if (!response.ok) throw new Error("Cloudflare backend failed to fetch runs.");
    
    const data = await response.json();
    
    // THE MAGIC DEBUGGER: Print exactly what Strava handed back
    console.log("Strava API Response:", data); 

    // Safety Check: If data is NOT an array (a list of runs), stop and alert the user.
    if (!Array.isArray(data)) {
        console.error("Strava Error Details:", data);
        alert("Strava returned an error! Check the console for details.");
        return; 
    }
    
    let syncedCount = 0;

    data.forEach(activity => {
      if (activity.type !== 'Run') return;

      const miles = (activity.distance * 0.000621371).toFixed(2); 
      const elevFt = (activity.total_elevation_gain * 3.28084).toFixed(0); 

      if (activity.average_speed > 0) {
        const minsPerMileDecimal = 26.8224 / activity.average_speed; 
        const paceMins = Math.floor(minsPerMileDecimal);
        const paceSecs = Math.floor((minsPerMileDecimal - paceMins) * 60).toString().padStart(2, '0');
        const paceString = `${paceMins}:${paceSecs}`;
        
        const runDate = activity.start_date_local.split('T')[0];
        const workoutToUpdate = workouts.find(w => w.date === runDate);
        
        if (workoutToUpdate && !workoutToUpdate.actualMiles) {
          workoutToUpdate.actualMiles = miles;
          workoutToUpdate.actualPace = paceString;
          workoutToUpdate.actualElev = elevFt;
          
          const elevPerMile = elevFt / miles;
          const gapAdjustment = (elevPerMile / 100) * 15;
          const rawSecs = (paceMins * 60) + parseInt(paceSecs);
          let gapSecs = rawSecs - gapAdjustment;
          if (gapSecs < 0) gapSecs = rawSecs;
          
          const gM = Math.floor(gapSecs / 60);
          const gS = Math.floor(gapSecs % 60).toString().padStart(2, '0');
          workoutToUpdate.actualGap = `${gM}:${gS}`;
          
          workoutToUpdate.notes = `Strava Sync: ${activity.name}`;
          workoutToUpdate.mapPolyline = activity.map.summary_polyline;
          syncedCount++;
        }
      }
    });

    localStorage.setItem('baileyCoachData_v2', JSON.stringify(workouts)); 
    alert(`✅ Successfully synced ${syncedCount} new runs via Cloudflare!`);
    updateWidgets();
    renderDashboard();
    renderCalendar();
    renderChart(); 

  } catch (error) {
    console.error(error);
    alert("Strava Sync Failed. Check the console.");
  }
}
