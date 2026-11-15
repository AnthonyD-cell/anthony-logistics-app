
    const BASE_FEE = 600;
    const INCLUDED_KM = 15;
    let currentTotal = 600;
    let activePin = "";

    function toggleOtherInput() {
      const val = document.getElementById('hasOtherItems').value;
      const container = document.getElementById('otherItemContainer');
      if (val === 'yes') {
        container.classList.remove('hidden');
        document.getElementById('otherItemText').focus();
      } else {
        container.classList.add('hidden');
        document.getElementById('otherItemText').value = '';
      }
    }

    function getFormattedItemsList() {
      const fridges = parseInt(document.getElementById('qtyFridge').value) || 0;
      const tables = parseInt(document.getElementById('qtyTables').value) || 0;
      const chairs = parseInt(document.getElementById('qtyChairs').value) || 0;
      const hasOther = document.getElementById('hasOtherItems').value === 'yes';
      const otherText = document.getElementById('otherItemText').value.trim();

      const parts = [];
      if (fridges > 0) parts.push(`${fridges}x Fridge`);
      if (tables > 0) parts.push(`${tables}x Table${tables > 1 ? 's' : ''}`);
      if (chairs > 0) parts.push(`${chairs}x Chair${chairs > 1 ? 's' : ''}`);
      if (hasOther && otherText) parts.push(otherText);

      return parts.length > 0 ? parts.join(', ') : 'General Household Goods';
    }

    function updateMapsLink() {
      const start = encodeURIComponent(document.getElementById('startLoc').value.trim() || 'Danville, Pretoria');
      const waypoint = document.getElementById('waypointLoc').value.trim();
      const end = encodeURIComponent(document.getElementById('endLoc').value.trim());

      let url = `https://www.google.com/maps/dir/${start}/`;
      if (waypoint) url += `${encodeURIComponent(waypoint)}/`;
      if (end) url += `${end}/`;

      document.getElementById('googleMapsRouteBtn').href = url;
    }

    // Google Maps Link Parser
    async function parseGoogleMapsLink() {
      const rawLink = document.getElementById('mapsLinkInput').value.trim();
      const statusEl = document.getElementById('linkImportStatus');

      if (!rawLink) {
        statusEl.textContent = "⚠️ Please paste a Google Maps link first.";
        statusEl.className = "text-xs text-center text-amber-400";
        statusEl.classList.remove('hidden');
        return;
      }

      statusEl.textContent = "Parsing link & expanding short URL if needed...";
      statusEl.className = "text-xs text-center text-blue-300";
      statusEl.classList.remove('hidden');

      try {
        let targetUrl = rawLink;
        // If it's a short URL (maps.app.goo.gl), we fetch it to resolve the full redirect URL
        if (rawLink.includes('maps.app.goo.gl') || rawLink.includes('goo.gl')) {
          try {
            const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(rawLink)}`);
            const data = await res.json();
            if (data && data.contents) {
              const match = data.contents.match(/href="([^"]*google\.com\/maps[^"]*)"/);
              if (match) targetUrl = match[1];
            }
          } catch(e) {
            // Fallback if shortener expansion fails
          }
        }

        // Extract locations from Google Maps URL structure (/dir/Start/Waypoint/End or query parameters)
        let foundStart = "";
        let foundWaypoint = "";
        let foundEnd = "";

        if (targetUrl.includes('/dir/')) {
          const parts = targetUrl.split('/dir/')[1].split('/')[0].split('?')[0].split('/');
          // Clean up url-encoded values
          const decodedParts = parts.map(p => decodeURIComponent(p.replace(/\+/g, ' ')));
          
          if (decodedParts.length >= 2) {
            foundStart = decodedParts[0];
            foundEnd = decodedParts[decodedParts.length - 1];
            if (decodedParts.length === 3) {
              foundWaypoint = decodedParts[1];
            }
          }
        } else {
          // Check for query parameters like ?q= or destination=
          const urlObj = new URL(targetUrl.includes('http') ? targetUrl : 'https://' + targetUrl);
          const qParam = urlObj.searchParams.get('q') || urlObj.searchParams.get('destination');
          if (qParam) {
            foundEnd = qParam;
          }
        }

        if (foundStart || foundEnd) {
          if (foundStart) document.getElementById('startLoc').value = foundStart;
          if (foundWaypoint) {
            document.getElementById('waypointLoc').value = foundWaypoint;
          } else {
            document.getElementById('waypointLoc').value = "";
          }
          if (foundEnd) document.getElementById('endLoc').value = foundEnd;

          updateMapsLink();
          statusEl.textContent = "✅ Link successfully parsed! Calculating accurate distance...";
          statusEl.className = "text-xs text-center text-emerald-400 font-semibold";

          // Automatically trigger distance calculation
          await fetchAccurateDistance();
        } else {
          throw new Error("Could not extract locations from this link. Try pasting a standard Google Maps directions URL.");
        }
      } catch (err) {
        statusEl.textContent = `❌ ${err.message}`;
        statusEl.className = "text-xs text-center text-rose-400";
      }
    }

    // Geocode address using Nominatim
    async function geocodeLocation(query) {
      const coordMatch = query.match(/(-?\d{1,2}\.\d{3,8})\s*,\s*(-?\d{1,3}\.\d{3,8})/);
      if (coordMatch) {
        return { lat: parseFloat(coordMatch[1]), lon: parseFloat(coordMatch[2]) };
      }

      const searchQuery = query.toLowerCase().includes('south africa') ? query : `${query}, Gauteng, South Africa`;
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(searchQuery)}`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();
      if (data && data.length > 0) {
        return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      }
      throw new Error(`Could not locate "${query}". Check address name.`);
    }

    // Calculate real road driving distance via OSRM
    async function fetchAccurateDistance() {
      const startVal = document.getElementById('startLoc').value.trim();
      const waypointVal = document.getElementById('waypointLoc').value.trim();
      const endVal = document.getElementById('endLoc').value.trim();
      const statusEl = document.getElementById('distanceApiStatus');
      const btn = document.getElementById('calcDistBtn');

      if (!startVal || !endVal) return;

      btn.disabled = true;
      btn.innerHTML = "<span>⏳ Calculating Route...</span>";
      statusEl.textContent = "Finding exact road route...";
      statusEl.className = "text-xs text-center text-blue-300";
      statusEl.classList.remove('hidden');

      try {
        const points = [];
        points.push(await geocodeLocation(startVal));
        if (waypointVal) points.push(await geocodeLocation(waypointVal));
        points.push(await geocodeLocation(endVal));

        const coordsStr = points.map(p => `${p.lon},${p.lat}`).join(';');
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=false`;
        const routeRes = await fetch(osrmUrl);
        const routeData = await routeRes.json();

        if (routeData.code === 'Ok' && routeData.routes && routeData.routes.length > 0) {
          const distanceMeters = routeData.routes[0].distance;
          const durationSeconds = routeData.routes[0].duration;
          const km = (distanceMeters / 1000).toFixed(1);
          const mins = Math.round(durationSeconds / 60);

          document.getElementById('totalKm').value = km;
          calculateQuote();

          statusEl.textContent = `✅ Accurate Road Distance: ${km} km (~${mins} mins drive)`;
          statusEl.className = "text-xs text-center text-emerald-400 font-semibold";
        } else {
          throw new Error("No driving route found between these points.");
        }
      } catch (err) {
        statusEl.textContent = `❌ ${err.message}`;
        statusEl.className = "text-xs text-center text-rose-400";
      } finally {
        btn.disabled = false;
        btn.innerHTML = "<span>🧭 Calculate Accurate Distance</span>";
        updateMapsLink();
      }
    }

    function calculateQuote() {
      const km = parseFloat(document.getElementById('totalKm').value) || 0;
      const rate = parseFloat(document.getElementById('ratePerKm').value) || 0;
      const fridges = parseInt(document.getElementById('qtyFridge').value) || 0;
      const hasStairs = document.getElementById('stairsFee').checked;

      const extraKm = Math.max(0, km - INCLUDED_KM);
      const extraCost = extraKm * rate;
      const addons = (fridges * 150) + (hasStairs ? 100 : 0);

      currentTotal = BASE_FEE + extraCost + addons;

      document.getElementById('extraKmLabel').textContent = `Extra Distance (${extraKm.toFixed(1)} km × R${rate.toFixed(2)}):`;
      document.getElementById('extraKmCost').textContent = `R ${extraCost.toFixed(2)}`;
      document.getElementById('addonsCost').textContent = `R ${addons.toFixed(2)}`;
      document.getElementById('totalQuote').textContent = `R ${currentTotal.toFixed(2)}`;
    }

    // Screenshot Scanner fallback
    async function processScreenshot(event) {
      const file = event.target.files[0];
      if (!file) return;
      const statusBox = document.getElementById('ocrStatusBox');
      const statusText = document.getElementById('ocrStatusText');
      statusBox.classList.remove('hidden');
      statusText.textContent = "Scanning screenshot...";
      try {
        const worker = await Tesseract.createWorker('eng', 1, { workerBlobURL: true });
        const { data: { text } } = await worker.recognize(file);
        await worker.terminate();
        statusText.textContent = "Scan complete!";
      } catch (e) {
        statusText.textContent = "Scan failed.";
      }
    }

    function generateTripTicket() {
      const start = document.getElementById('startLoc').value.trim() || "Pretoria";
      const waypoint = document.getElementById('waypointLoc').value.trim();
      const end = document.getElementById('endLoc').value.trim() || "Destination";
      const name = document.getElementById('clientName').value.trim() || "Valued Client";
      const phone = document.getElementById('clientPhone').value.trim();
      const items = getFormattedItemsList();

      activePin = Math.floor(1000 + Math.random() * 9000).toString();
      const routeDisplay = waypoint ? `${start} → ${waypoint} → ${end}` : `${start} → ${end}`;

      document.getElementById('ticketRoute').textContent = routeDisplay;
      document.getElementById('generatedPin').textContent = activePin;
      document.getElementById('ticketClient').textContent = `${name} ${phone ? '(' + phone + ')' : ''}`;
      document.getElementById('ticketFare').textContent = `R ${currentTotal.toFixed(2)}`;
      document.getElementById('ticketItems').textContent = items;

      const cleanPhone = phone.replace(/\s+/g, '');
      document.getElementById('callClientBtn').href = cleanPhone ? `tel:${cleanPhone}` : "#";

      document.getElementById('verifyPinInput').value = "";
      document.getElementById('verifyResult').classList.add('hidden');
      document.getElementById('ticketSection').classList.remove('hidden');
      document.getElementById('ticketSection').scrollIntoView({ behavior: 'smooth' });
    }

    function copyWhatsAppMessage() {
      const start = document.getElementById('startLoc').value.trim() || "Pretoria";
      const waypoint = document.getElementById('waypointLoc').value.trim();
      const end = document.getElementById('endLoc').value.trim() || "Destination";
      const km = document.getElementById('totalKm').value;
      const items = getFormattedItemsList();
      const routeDisplay = waypoint ? `${start} → ${waypoint} → ${end}` : `${start} to ${end}`;

      const msg = `*ANTHONY LOGISTICS MOVING SERVICES*\n` +
                  `Route: ${routeDisplay} (${km} km)\n` +
                  `Items: ${items}\n` +
                  `Total Quote: *R${currentTotal.toFixed(2)}*\n` +
                  `-----------------------------\n` +
                  `Your Safety Verification PIN: *${activePin}*\n` +
                  `Please share this 4-digit PIN with your driver upon arrival before loading.\n` +
                  `Driver Contact: +27 63 660 6702`;

      navigator.clipboard.writeText(msg).then(() => {
        const fb = document.getElementById('copyFeedback');
        fb.classList.remove('hidden');
        setTimeout(() => fb.classList.add('hidden'), 3000);
      });
    }

    function verifyClientPin() {
      const entered = document.getElementById('verifyPinInput').value.trim();
      const resultEl = document.getElementById('verifyResult');
      resultEl.classList.remove('hidden');

      if (entered === activePin && activePin !== "") {
        resultEl.textContent = "✅ PIN VERIFIED! Safe to load and begin trip.";
        resultEl.className = "text-xs font-bold text-center pt-1 text-emerald-400";
      } else {
        resultEl.textContent = "❌ INCORRECT PIN! Do not load until client confirms.";
        resultEl.className = "text-xs font-bold text-center pt-1 text-rose-400";
      }
    }

    updateMapsLink();
    calculateQuote();
  