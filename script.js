
const API_URL = "https://script.google.com/macros/s/AKfycbxXxwEdAqQOvXp2o1P7iEsJ9D8NuIYNmkgb1wNQIJ4sny2Bf4lIMuwPW7Ev3zv8rmC0/exec"; 


const ratePlanSelect = document.getElementById("ratePlan");
const searchBtn = document.getElementById("searchBtn");
const resultsDiv = document.getElementById("results");
const bookingPanel = document.getElementById("bookingPanel");
const guestName = document.getElementById("guestName");
const guestEmail = document.getElementById("guestEmail");
const guestPhone = document.getElementById("guestPhone");
const selectedRoomSpan = document.getElementById("selectedRoom");
const selectedTotalSpan = document.getElementById("selectedTotal");
const confirmBookingBtn = document.getElementById("confirmBookingBtn");
const cancelBookingBtn = document.getElementById("cancelBookingBtn");
const confirmationModal = document.getElementById("confirmationModal");
const modalTitle = document.getElementById("modalTitle");
const modalText = document.getElementById("modalText");
const closeModalBtn = document.getElementById("closeModalBtn");

let selectedBooking = null;


async function apiGet(params) {
  const url = API_URL + "?" + new URLSearchParams(params).toString();
  const res = await fetch(url, { method: "GET", mode: "cors", headers: { "Accept": "application/json" } });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error("GET error: " + res.status + " " + txt);
  }
  return res.json();
}


async function apiPost(payload) {
  const res = await fetch(API_URL, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "text/plain", "Accept": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error("POST error: " + res.status + " " + txt);
  }
  return res.json();
}


async function loadRatePlans() {
  try {
    const plans = await apiGet({ action: "rateplans" });
    ratePlanSelect.innerHTML = "<option value=''>All</option>";
    if (!Array.isArray(plans) || plans.length === 0) {
      ratePlanSelect.innerHTML += "<option value=''>No plans</option>";
      return;
    }
    plans.forEach(p => {
      
      const name = p.Name || p.name || p['PlanID'] || Object.values(p)[0] || "";
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      ratePlanSelect.appendChild(opt);
    });
  } catch (err) {
    console.error("loadRatePlans error", err);
    ratePlanSelect.innerHTML = "<option value=''>Error loading plans</option>";
  }
}

searchBtn.addEventListener("click", async () => {
  const checkIn = document.getElementById("checkIn").value;
  const checkOut = document.getElementById("checkOut").value;
  const adults = document.getElementById("adults").value;
  const children = document.getElementById("children").value;
  const plan = ratePlanSelect.value;

  if (!checkIn || !checkOut) {
    alert("Please select check-in and check-out.");
    return;
  }
  resultsDiv.innerHTML = "<div class='card'>Searching...</div>";

  try {
    const data = await apiGet({
      action: "availability",
      checkin: checkIn,
      checkout: checkOut,
      adults: adults,
      children: children,
      plan: plan
    });

    
    resultsDiv.innerHTML = "";
    const results = (data && data.results) ? data.results : [];
    if (!results || results.length === 0) {
      resultsDiv.innerHTML = "<div class='card muted'>No rooms available for selected dates.</div>";
      return;
    }

    results.forEach(room => {
      const div = document.createElement("div");
      div.className = "room";
      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong>${room.Name}</strong>
            <div class="muted">Nights: ${room.nights} • Plan: ${room.plan || "—"}</div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:800;font-size:18px">₹ ${room.total}</div>
            <button class="selectBtn" style="margin-top:6px">Select</button>
          </div>
        </div>
      `;
      div.querySelector(".selectBtn").addEventListener("click", () => {
        selectedBooking = room;
        selectedRoomSpan.textContent = `${room.Name} (${room.plan || ""})`;
        selectedTotalSpan.textContent = room.total;
        bookingPanel.style.display = "block";
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      });
      resultsDiv.appendChild(div);
    });
  } catch (err) {
    console.error("search error", err);
    resultsDiv.innerHTML = "<div class='card muted'>Error fetching availability. Check console.</div>";
  }
});


cancelBookingBtn.addEventListener("click", () => {
  bookingPanel.style.display = "none";
  selectedBooking = null;
});


confirmBookingBtn.addEventListener("click", async () => {
  if (!selectedBooking) {
    alert("Please select a room first.");
    return;
  }
  const name = guestName.value.trim();
  const email = guestEmail.value.trim();
  const phone = guestPhone.value.trim();
  if (!name || !email) {
    alert("Please enter guest name and email.");
    return;
  }

  const payload = {
    action: "book",
    guestName: name,
    email: email,
    phone: phone,
    roomTypeID: selectedBooking.RoomTypeID,
    planName: selectedBooking.plan,
    total: selectedBooking.total,
    checkIn: document.getElementById("checkIn").value,
    checkOut: document.getElementById("checkOut").value,
    adults: document.getElementById("adults").value,
    children: document.getElementById("children").value
  };

  try {
    const res = await apiPost(payload);
    if (res && res.ok) {
      modalTitle.textContent = "Booking Confirmed";
      modalText.innerHTML = `Booking ID: <strong>${res.bookingID}</strong><br/>Room: ${selectedBooking.Name}<br/>Guest: ${name}<br/>Total: ₹ ${selectedBooking.total}`;
      confirmationModal.style.display = "flex";
      bookingPanel.style.display = "none";
      
      selectedBooking = null;
    } else {
      modalTitle.textContent = "Booking Failed";
      modalText.textContent = res.message || "Unknown error";
      confirmationModal.style.display = "flex";
    }
  } catch (err) {
    console.error("booking error", err);
    modalTitle.textContent = "Booking Error";
    modalText.textContent = err.message || "See console for details.";
    confirmationModal.style.display = "flex";
  }
});

closeModalBtn.addEventListener("click", () => {
  confirmationModal.style.display = "none";
});

// Initial load
loadRatePlans();

