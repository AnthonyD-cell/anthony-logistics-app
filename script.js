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

    async function parseGoogleMapsLink() {
      const rawLink = document.getElementById('mapsLinkInput').value.trim();
      const statusEl = document.getElementById('linkImportStatus');

      if (!rawLink) {
        statusEl.textContent = "⚠️ Please paste a Google Maps link first.";
        statusEl.className = "text-xs text-center text-amber-400";
        statusEl.classList.remove('hidden');
        return;
      }

      statusEl.textContent = "Extracting route from Google Maps link...";
      statusEl.className = "text-xs text-center text-blue-300";
      statusEl.classList.remove('hidden');

      try {
        let targetUrl = rawLink;

        // Expand short links if /api/expand-url is deployed
        if (rawLink.includes('maps.app.goo.gl') || rawLink.includes('goo.gl')) {
          try {
            const res = await fetch(`/api/expand-url?url=${encodeURIComponent(rawLink)}`);
            const data = await res.json();
            if (data.expandedUrl) targetUrl = data.expandedUrl;
          } catch (e) {
            // Continue with original URL if endpoint isn't present
          }
        }

        let foundStart = "";
        let foundWaypoint = "";
        let foundEnd = "";

        if (targetUrl.includes('/dir/')) {
          const afterDir = targetUrl.split('/dir/')[1].split('?')[0];

          // Strip out @viewport coordinates and data=!3m1... metadata blocks
          const cleanSegments = afterDir
            .split('/')
            .filter(seg => seg && !seg.startsWith('@') && !seg.startsWith('data='))
            .map(seg => decodeURIComponent(seg.replace(/\+/g, ' ')).trim());

          if (cleanSegments.length >= 2) {
            foundStart = cleanSegments[0];
            foundEnd = cleanSegments[cleanSegments.length - 1];
            if (cleanSegments.length >= 3) {
              foundWaypoint = cleanSegments[1];
            }
          }
        } else {
          const urlObj = new URL(targetUrl.includes('http') ? targetUrl : 'https://' + targetUrl);
          const qParam = urlObj.searchParams.get('q') || urlObj.searchParams.get('destination');
          if (qParam) foundEnd = decodeURIComponent(qParam.replace(/\+/g, ' ')).trim();
        }

        if (foundStart || foundEnd) {
          if (foundStart) document.getElementById('startLoc').value = foundStart;
          document.getElementById('waypointLoc').value = foundWaypoint || "";
          if (foundEnd) document.getElementById('endLoc').value = foundEnd;

          updateMapsLink();

          // Extract exact GPS coordinates from Google Maps data=!2d<lng>!2d<lat> pairs if present
          const coordPairs = [...targetUrl.matchAll(/!2d(-?\d+\.\d+)!2d(-?\d+\.\d+)/g)];
          if (coordPairs.length >= 2) {
            const startCoords = `${coordPairs[0][2]}, ${coordPairs[0][1]}`;
            const endCoords = `${coordPairs[coordPairs.length - 1][2]}, ${coordPairs[coordPairs.length - 1][1]}`;

            statusEl.textContent = "✅ Exact GPS coordinates extracted! Calculating driving distance...";
            statusEl.className = "text-xs text-center text-emerald-400 font-semibold";
            await calculateDistanceFromCoords(startCoords, endCoords);
            return;
          }

          statusEl.textContent = "✅ Route imported! Calculating driving distance...";
          statusEl.className = "text-xs text-center text-emerald-400 font-semibold";
          await fetchAccurateDistance();
        } else {
          throw new Error("Could not extract locations from that link.");
        }
      } catch (err) {
        statusEl.textContent = `❌ ${err.message}`;
        statusEl.className = "text-xs text-center text-rose-400";
      }
    }

    // Direct OSRM routing using exact GPS coordinates from the Google Maps URL
    async function calculateDistanceFromCoords(startCoordStr, endCoordStr) {
      const statusEl = document.getElementById('distanceApiStatus');
      try {
        const p1 = await geocodeLocation(startCoordStr);
        const p2 = await geocodeLocation(endCoordStr);
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${p1.lon},${p1.lat};${p2.lon},${p2.lat}?overview=false`;
        const routeRes = await fetch(osrmUrl);
        const routeData = await routeRes.json();

        if (routeData.code === 'Ok' && routeData.routes && routeData.routes.length > 0) {
          const rawKm = routeData.routes[0].distance / 1000;
          const calibratedKm = (rawKm * 1.15).toFixed(1);
          const mins = Math.round(routeData.routes[0].duration / 60);

          document.getElementById('totalKm').value = calibratedKm;
          calculateQuote();

          statusEl.textContent = `✅ Accurate Road Distance: ${calibratedKm} km (~${mins} mins drive)`;
          statusEl.className = "text-xs text-center text-emerald-400 font-semibold";
          statusEl.classList.remove('hidden');
        }
      } catch (e) {
        await fetchAccurateDistance();
      }
    }

    async function geocodeLocation(query) {
      const coordMatch = query.match(/(-?\d{1,2}\.\d{3,8})\s*,\s*(-?\d{1,3}\.\d{3,8})/);
      if (coordMatch) {
        return { lat: parseFloat(coordMatch[1]), lon: parseFloat(coordMatch[2]) };
      }

      let cleanedQuery = query
        .replace(/[^,\n]+-\s*Cosmopolitan Projects,?/gi, '') // Removes developer prefixes
        .replace(/Cosmopolitan Projects/gi, '')
        .replace(/,\s*\d{4}\b/g, '') // Removes postal codes
        .trim();

      let searchQuery = cleanedQuery.toLowerCase().includes('south africa') ? cleanedQuery : `${cleanedQuery}, South Africa`;
      let url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(searchQuery)}`;
      let res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      let data = await res.json();

      if (data && data.length > 0) {
        return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      }

      const parts = query.split(',').map(p => p.trim());
      if (parts.length >= 2) {
        const fallbackQuery = `${parts[parts.length - 3] || parts[0]}, Pretoria, South Africa`;
        url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(fallbackQuery)}`;
        res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        data = await res.json();
        if (data && data.length > 0) {
          return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
        }
      }

      throw new Error(`Could not locate "${query}". Try shortening the address to just the estate or street name.`);
    }

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
          
          let rawKm = distanceMeters / 1000;
          const calibratedKm = (rawKm * 1.15).toFixed(1); // 1.15x Gauteng traffic calibration
          const mins = Math.round(durationSeconds / 60);

          document.getElementById('totalKm').value = calibratedKm;
          calculateQuote();

          statusEl.textContent = `✅ Accurate Road Distance: ${calibratedKm} km (~${mins} mins drive)`;
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