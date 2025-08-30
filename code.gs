

const SHEET_ID = "16VSJa8ylBPx3kyL3-V3gY74rqhOlEH8g5Xg6Hy47Uzk"; 
const SHEET_ROOMS = "Rooms";
const SHEET_INVENTORY = "Inventory";
const SHEET_RATEPLANS = "RatePlans";
const SHEET_BOOKINGS = "Bookings";


function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseDateString(dateStr) {
  
  const d = new Date(dateStr);
  return (d instanceof Date && !isNaN(d)) ? d : null;
}

function daysBetween(start, end) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((end - start) / msPerDay);
}


function normalizeModifier(val) {
  if (val === null || val === undefined || val === "") return 0;
  const num = Number(val);
  if (isNaN(num)) return 0;
  return (num <= 1) ? num : num / 100;
}

// ---------- Entrypoints ----------
function doGet(e) {
  try {
    const action = (e.parameter.action || "").toString().toLowerCase();
    if (action === "rateplans") {
      return jsonOutput(getRatePlans());
    } else if (action === "availability" || action === "inventory") {
      return jsonOutput(getAvailability(e));
    } else {
      return jsonOutput({ error: "Invalid action. Use ?action=rateplans or ?action=availability" });
    }
  } catch (err) {
    return jsonOutput({ error: err.message });
  }
}


function doPost(e) {
  try {
    
    const raw = e.postData && e.postData.contents ? e.postData.contents : null;
    if (!raw) return jsonOutput({ ok: false, message: "No payload" });

    const payload = JSON.parse(raw);
    if (!payload || !payload.action) {
      return jsonOutput({ ok: false, message: "Invalid payload" });
    }

    const action = (payload.action || "").toString().toLowerCase();
    if (action === "book") {
      return jsonOutput(handleBooking(payload));
    } else {
      return jsonOutput({ ok: false, message: "Unknown action in POST body" });
    }
  } catch (err) {
    return jsonOutput({ ok: false, message: err.message });
  }
}


function doOptions(e) {
  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}

// ---------- Data access ----------
function getRatePlans() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_RATEPLANS);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return [];

  const headers = data[0];
  const plans = data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
  return plans;
}


function getAvailability(e) {
  const checkin = e.parameter.checkin;
  const checkout = e.parameter.checkout;
  const adults = Number(e.parameter.adults || 1);
  const children = Number(e.parameter.children || 0);
  const planName = e.parameter.plan || "";

  const checkInDate = parseDateString(checkin);
  const checkOutDate = parseDateString(checkout);
  if (!checkInDate || !checkOutDate || checkOutDate <= checkInDate) {
    return { results: [], message: "Invalid or missing checkin/checkout dates" };
  }

 
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const roomsSheet = ss.getSheetByName(SHEET_ROOMS);
  const invSheet = ss.getSheetByName(SHEET_INVENTORY);
  const plansSheet = ss.getSheetByName(SHEET_RATEPLANS);

  const rooms = (roomsSheet ? roomsSheet.getDataRange().getValues() : []);
  const inv = (invSheet ? invSheet.getDataRange().getValues() : []);
  const plans = (plansSheet ? plansSheet.getDataRange().getValues() : []);

  if (!rooms || rooms.length < 2) return { results: [], message: "No room definitions found" };

  const roomHeaders = rooms[0];
  const roomsData = rooms.slice(1).map(r => {
    const o = {};
    roomHeaders.forEach((h, i) => o[h] = r[i]);
    return o;
  });

  
  const invHeaders = (inv && inv.length > 0) ? inv[0] : [];
  const invRows = (inv && inv.length > 1) ? inv.slice(1) : [];
  const invMap = {}; // key -> {Allotment, Booked, rowIndex} ; rowIndex is 2-based sheet row index
  for (let r = 0; r < invRows.length; r++) {
    const row = invRows[r];
    const rowObj = {};
    invHeaders.forEach((h, i) => rowObj[h] = row[i]);
    
    const dateCell = rowObj[invHeaders[0]];
    
    let d;
    if (dateCell instanceof Date) {
      d = Utilities.formatDate(dateCell, Session.getScriptTimeZone(), "yyyy-MM-dd");
    } else {
      d = Utilities.formatDate(new Date(dateCell), Session.getScriptTimeZone(), "yyyy-MM-dd");
    }
    const roomTypeID = String(rowObj['RoomTypeID']);
    const allot = Number(rowObj['Allotment'] || 0);
    const booked = Number(rowObj['Booked'] || 0);
    const key = d + '|' + roomTypeID;
    invMap[key] = {
      Allotment: allot,
      Booked: booked,
      sheetRow: r + 2 // +2 because header + 1-index
    };
  }

 
  let planModifier = 0;
  if (plans && plans.length > 1) {
    const planHeaders = plans[0];
    const planRows = plans.slice(1);
    for (let i = 0; i < planRows.length; i++) {
      const pr = {};
      planHeaders.forEach((h, idx) => pr[h] = planRows[i][idx]);
      if (String(pr['Name'] || "") === String(planName)) {
        planModifier = normalizeModifier(pr['ModifierPercent']);
        break;
      }
    }
  }

  
  const results = [];
  for (const room of roomsData) {
    const roomTypeID = String(room['RoomTypeID']);
    const roomName = room['Name'];
    
    let basePrice = Number(room['BaseSingle'] || 0);
    if (adults > 1 && room['BaseDouble']) basePrice = Number(room['BaseDouble']);

    let available = true;
    let total = 0;
    const breakdown = [];

    for (let d = new Date(checkInDate); d < checkOutDate; d.setDate(d.getDate() + 1)) {
      const dateStr = Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
      const key = dateStr + '|' + roomTypeID;
      const invEntry = invMap[key];
      if (!invEntry) {
        available = false;
        break;
      }
      const free = invEntry.Allotment - invEntry.Booked;
      if (free <= 0) {
        available = false;
        break;
      }
      
      const nightly = Math.round(basePrice * (1 + (planModifier || 0)));
      breakdown.push({ date: dateStr, price: nightly });
      total += nightly;
    }

    if (available) {
      results.push({
        RoomTypeID: roomTypeID,
        Name: roomName,
        basePrice: basePrice,
        plan: planName,
        nights: Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24)),
        total: total,
        breakdown: breakdown
      });
    }
  }

  return { results: results };
}


function handleBooking(payload) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const bookingsSheet = ss.getSheetByName(SHEET_BOOKINGS);
    const invSheet = ss.getSheetByName(SHEET_INVENTORY);

    const bookingID = "BK" + Utilities.getUuid().slice(0, 8);
    const ts = new Date();

   
    const guestName = payload.guestName || "";
    const email = payload.email || "";
    const phone = payload.phone || "";
    const roomTypeID = payload.roomTypeID || "";
    const planName = payload.planName || "";
    const total = payload.total || 0;
    const checkIn = payload.checkIn;
    const checkOut = payload.checkOut;
    const adults = payload.adults || 1;
    const children = payload.children || 0;

    
    if (!bookingsSheet) throw new Error("Bookings sheet not found");
    
    if (bookingsSheet.getLastRow() === 0) {
      bookingsSheet.appendRow(["BookingID", "Timestamp", "GuestName", "Email", "Phone", "RoomTypeID", "PlanID", "Total", "CheckIn", "CheckOut", "Adults", "Children"]);
    }

    bookingsSheet.appendRow([bookingID, ts, guestName, email, phone, roomTypeID, planName, total, checkIn, checkOut, adults, children]);

    
    const invRange = invSheet.getDataRange();
    const invValues = invRange.getValues();
    const headers = invValues[0];
   
    const dateColIdx = headers.indexOf(headers[0]); 
    const roomTypeIdx = headers.indexOf('RoomTypeID');
    const bookedIdx = headers.indexOf('Booked');

    
    const map = {};
    for (let r = 1; r < invValues.length; r++) {
      const row = invValues[r];
      
      let dateCell = row[0];
      let dateStr;
      if (dateCell instanceof Date) {
        dateStr = Utilities.formatDate(dateCell, Session.getScriptTimeZone(), "yyyy-MM-dd");
      } else {
        dateStr = Utilities.formatDate(new Date(dateCell), Session.getScriptTimeZone(), "yyyy-MM-dd");
      }
      const rid = String(row[roomTypeIdx]);
      map[dateStr + '|' + rid] = r + 1; // 1-based sheet row index
    }

    
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const ds = Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
      const key = ds + '|' + roomTypeID;
      if (map[key]) {
        const rowNumber = map[key];
        const currentBooked = invSheet.getRange(rowNumber, bookedIdx + 1).getValue();
        invSheet.getRange(rowNumber, bookedIdx + 1).setValue(Number(currentBooked || 0) + 1);
      } else {
       
      }
    }

    return { ok: true, bookingID: bookingID };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

