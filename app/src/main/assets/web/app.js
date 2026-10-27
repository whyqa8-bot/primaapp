(function () {
  'use strict';

  // ---------- Konfigurasi ----------
  var DEFAULT_CENTER = [-6.1754, 106.8272]; // Jakarta (dipakai bila GPS tidak tersedia)
  var OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  var NOMINATIM = 'https://nominatim.openstreetmap.org/';
  var STORE_KEY = 'primacarts_orders_v1';

  var SERVICES = {
    passenger: [
      { id: 'bike',  name: 'Prima Bike',    icon: '🏍️', desc: 'Ojek motor · 1 penumpang',      base: 3000, perKm: 2500, min: 9000 },
      { id: 'car',   name: 'Prima Car',     icon: '🚗',       desc: 'Mobil · 4 penumpang',           base: 6000, perKm: 4500, min: 18000 },
      { id: 'carxl', name: 'Prima Car XL',  icon: '🚐',       desc: 'Mobil besar · 6 penumpang',     base: 8000, perKm: 5500, min: 25000 }
    ],
    courier: [
      { id: 'send_bike', name: 'Prima Send Motor', icon: '📦', desc: 'Kurir motor · barang kecil (maks. 20 kg)',  base: 5000,  perKm: 2800, min: 10000 },
      { id: 'send_car',  name: 'Prima Send Mobil', icon: '🚚', desc: 'Kurir mobil · barang besar (maks. 200 kg)', base: 15000, perKm: 5000, min: 30000 }
    ]
  };

  var state = {
    mode: 'passenger',
    pickup: null,
    dest: null,
    active: 'pickup',
    route: null,
    routing: false,
    selected: { passenger: 'bike', courier: 'send_bike' }
  };

  var routeSeq = 0;
  var revSeq = { pickup: 0, dest: 0 };
  var markers = { pickup: null, dest: null };
  var routeLine = null;
  var searchTimer = null;
  var findTimer = null;
  var toastTimer = null;

  // ---------- Util ----------
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function rupiah(n) {
    return 'Rp' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function round500(n) { return Math.ceil(n / 500) * 500; }

  function fare(svc, km) {
    return Math.max(svc.min, round500(svc.base + svc.perKm * km));
  }

  function fmtKm(meters) { return (meters / 1000).toFixed(1).replace('.', ',') + ' km'; }

  function fmtMin(seconds) {
    var m = Math.max(1, Math.round(seconds / 60));
    if (m < 60) { return m + ' mnt'; }
    return Math.floor(m / 60) + ' j ' + (m % 60) + ' mnt';
  }

  function haversine(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 3500);
  }

  function getJSON(url, ms) {
    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 12000) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (r) {
      if (timer) { clearTimeout(timer); }
      if (!r.ok) { throw new Error('HTTP ' + r.status); }
      return r.json();
    }).catch(function (e) {
      if (timer) { clearTimeout(timer); }
      throw e;
    });
  }

  function shortLabel(res) {
    if (!res || !res.display_name) { return ''; }
    return res.display_name.split(', ').slice(0, 3).join(', ');
  }

  function loadOrders() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveOrders(list) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, 50))); } catch (e) { /* abaikan */ }
  }
  function upsertOrder(order) {
    var list = loadOrders();
    var i = list.findIndex(function (o) { return o.id === order.id; });
    if (i >= 0) { list[i] = order; } else { list.unshift(order); }
    saveOrders(list);
  }

  // ---------- Peta ----------
  var map = L.map('map', { zoomControl: false }).setView(DEFAULT_CENTER, 12);
  map.attributionControl.setPrefix(false);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  function pinIcon(kind) {
    return L.divIcon({
      className: '',
      html: '<div class="pin pin-' + kind + '"></div>',
      iconSize: [28, 36],
      iconAnchor: [14, 34]
    });
  }

  function placeMarker(kind) {
    if (markers[kind]) { map.removeLayer(markers[kind]); markers[kind] = null; }
    var p = state[kind];
    if (!p) { return; }
    var m = L.marker([p.lat, p.lng], { draggable: true, icon: pinIcon(kind) }).addTo(map);
    m.on('dragend', function () {
      var ll = m.getLatLng();
      setPoint(kind, { lat: ll.lat, lng: ll.lng }, null, true);
    });
    markers[kind] = m;
  }

  function sheetHeight() { return $('sheet').offsetHeight || 300; }

  function fitAll() {
    var pts = [];
    if (state.pickup) { pts.push([state.pickup.lat, state.pickup.lng]); }
    if (state.dest) { pts.push([state.dest.lat, state.dest.lng]); }
    if (state.route && state.route.coords.length) {
      pts = pts.concat(state.route.coords);
    }
    if (pts.length < 2) { return; }
    map.fitBounds(L.latLngBounds(pts), {
      paddingTopLeft: [30, 90],
      paddingBottomRight: [30, sheetHeight() + 20],
      maxZoom: 17
    });
  }

  function clearRouteLine() {
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
  }

  function drawRoute() {
    clearRouteLine();
    if (!state.route) { return; }
    routeLine = L.polyline(state.route.coords, {
      color: '#1565c0', weight: 5, opacity: 0.85,
      dashArray: state.route.approx ? '8 8' : null
    }).addTo(map);
    fitAll();
  }

  // ---------- Titik jemput / tujuan ----------
  function inputOf(kind) { return $(kind === 'pickup' ? 'pickup' : 'dest'); }

  function setPoint(kind, p, label, fromDrag) {
    state[kind] = { lat: p.lat, lng: p.lng, label: label || 'Memuat alamat…' };
    if (!fromDrag) { placeMarker(kind); }
    inputOf(kind).value = state[kind].label;
    if (!label) { reverse(kind); }
    if (kind === 'pickup' && !state.dest) { state.active = 'dest'; }
    onPointsChanged(!fromDrag);
  }

  function reverse(kind) {
    var seq = ++revSeq[kind];
    var p = state[kind];
    var url = NOMINATIM + 'reverse?format=jsonv2&zoom=18&accept-language=id&lat=' + p.lat + '&lon=' + p.lng;
    getJSON(url, 10000).then(function (res) {
      if (seq !== revSeq[kind] || !state[kind]) { return; }
      var label = shortLabel(res) || 'Titik di peta';
      state[kind].label = label;
      inputOf(kind).value = label;
    }).catch(function () {
      if (seq !== revSeq[kind] || !state[kind]) { return; }
      var label = 'Titik di peta (' + p.lat.toFixed(4) + ', ' + p.lng.toFixed(4) + ')';
      state[kind].label = label;
      inputOf(kind).value = label;
    });
  }

  function onPointsChanged(pan) {
    if (state.pickup && state.dest) {
      fetchRoute();
    } else {
      routeSeq++;
      state.route = null;
      state.routing = false;
      clearRouteLine();
      var p = state.pickup || state.dest;
      if (pan && p) { map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15)); }
      renderOptions();
      updateOrderBtn();
    }
  }

  function fetchRoute() {
    var a = state.pickup, b = state.dest;
    var id = ++routeSeq;
    state.routing = true;
    state.route = null;
    clearRouteLine();
    renderOptions();
    updateOrderBtn();

    var url = OSRM + a.lng + ',' + a.lat + ';' + b.lng + ',' + b.lat + '?overview=full&geometries=geojson';
    getJSON(url, 15000).then(function (res) {
      if (id !== routeSeq) { return; }
      if (!res.routes || !res.routes.length) { throw new Error('no route'); }
      var r = res.routes[0];
      state.route = {
        distance: r.distance,
        duration: r.duration,
        coords: r.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }),
        approx: false
      };
    }).catch(function () {
      if (id !== routeSeq) { return; }
      var d = haversine(a, b) * 1.3;
      state.route = {
        distance: d,
        duration: d / 8.3, // sekitar 30 km/jam
        coords: [[a.lat, a.lng], [b.lat, b.lng]],
        approx: true
      };
      toast('Server rute tidak terjangkau, memakai perkiraan jarak.');
    }).then(function () {
      if (id !== routeSeq) { return; }
      state.routing = false;
      drawRoute();
      renderOptions();
      updateOrderBtn();
    });
  }

  // ---------- Pencarian alamat ----------
  function hideSuggestions() {
    $('sugPickup').innerHTML = '';
    $('sugDest').innerHTML = '';
  }

  function runSearch(kind, q) {
    var ul = $(kind === 'pickup' ? 'sugPickup' : 'sugDest');
    var c = map.getCenter();
    var d = 0.6;
    var viewbox = [c.lng - d, c.lat + d, c.lng + d, c.lat - d].join(',');
    var url = NOMINATIM + 'search?format=jsonv2&limit=5&countrycodes=id&accept-language=id' +
      '&viewbox=' + viewbox + '&q=' + encodeURIComponent(q);
    ul.innerHTML = '<li class="info">Mencari…</li>';
    getJSON(url, 10000).then(function (list) {
      if (!list.length) { ul.innerHTML = '<li class="info">Lokasi tidak ditemukan</li>'; return; }
      ul.innerHTML = '';
      list.forEach(function (r) {
        var parts = r.display_name.split(', ');
        var li = document.createElement('li');
        li.innerHTML = esc(parts.slice(0, 2).join(', ')) + '<small>' + esc(parts.slice(2, 5).join(', ')) + '</small>';
        li.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
        li.addEventListener('click', function () {
          ul.innerHTML = '';
          var pt = { lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
          setPoint(kind, pt, parts.slice(0, 3).join(', '));
          map.setView([pt.lat, pt.lng], 16);
        });
        ul.appendChild(li);
      });
    }).catch(function () {
      ul.innerHTML = '<li class="info">Gagal mencari. Periksa internet atau ketuk peta.</li>';
    });
  }

  function bindSearch(kind) {
    var input = inputOf(kind);
    input.addEventListener('focus', function () { state.active = kind; input.select(); });
    input.addEventListener('input', function () {
      clearTimeout(searchTimer);
      var q = input.value.trim();
      var ul = $(kind === 'pickup' ? 'sugPickup' : 'sugDest');
      if (q.length < 3) { ul.innerHTML = ''; return; }
      searchTimer = setTimeout(function () { runSearch(kind, q); }, 700);
    });
    input.addEventListener('blur', function () {
      setTimeout(function () {
        $(kind === 'pickup' ? 'sugPickup' : 'sugDest').innerHTML = '';
      }, 250);
    });
  }

  // ---------- GPS ----------
  function locate(auto) {
    if (!navigator.geolocation) {
      if (!auto) { toast('GPS tidak didukung di perangkat ini.'); }
      return;
    }
    var btn = $('btnLocate');
    btn.classList.add('busy');
    navigator.geolocation.getCurrentPosition(function (pos) {
      btn.classList.remove('busy');
      var p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      map.setView([p.lat, p.lng], 16);
      if (auto && state.pickup) { return; }
      setPoint('pickup', p, null);
    }, function () {
      btn.classList.remove('busy');
      toast(auto ? 'Aktifkan GPS, atau pilih lokasi jemput lewat pencarian / ketuk peta.'
                 : 'Lokasi tidak ditemukan. Pastikan GPS dan izin lokasi aktif.');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }

  // ---------- Tampilan layanan ----------
  function currentService() {
    var list = SERVICES[state.mode];
    var id = state.selected[state.mode];
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
    return list[0];
  }

  function renderOptions() {
    var box = $('options');
    var sum = $('summary');
    if (state.routing) {
      sum.innerHTML = 'Menghitung rute…';
      box.innerHTML = '<div class="placeholder">Mohon tunggu…</div>';
      return;
    }
    if (!state.route) {
      sum.innerHTML = '';
      box.innerHTML = '<div class="placeholder">Pilih titik ' +
        (state.mode === 'courier' ? 'ambil dan antar' : 'jemput dan tujuan') +
        ' untuk melihat tarif.</div>';
      return;
    }
    var km = state.route.distance / 1000;
    sum.innerHTML = '📏 <b>' + fmtKm(state.route.distance) + '</b> · ⏱ <b>' +
      fmtMin(state.route.duration) + '</b>' + (state.route.approx ? ' · perkiraan' : '');
    box.innerHTML = '';
    SERVICES[state.mode].forEach(function (svc) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt' + (svc.id === state.selected[state.mode] ? ' sel' : '');
      b.innerHTML = '<span class="ic">' + svc.icon + '</span>' +
        '<span class="tx"><b>' + esc(svc.name) + '</b><small>' + esc(svc.desc) + '</small></span>' +
        '<span class="pr">' + rupiah(fare(svc, km)) + '<small>est. ' + fmtMin(state.route.duration) + '</small></span>';
      b.addEventListener('click', function () {
        state.selected[state.mode] = svc.id;
        renderOptions();
      });
      box.appendChild(b);
    });
  }

  function updateOrderBtn() {
    $('btnOrder').disabled = !(state.route && !state.routing);
  }

  function setMode(mode) {
    state.mode = mode;
    $('tabPassenger').classList.toggle('active', mode === 'passenger');
    $('tabCourier').classList.toggle('active', mode === 'courier');
    $('courierBox').classList.toggle('hidden', mode !== 'courier');
    $('lblPickup').textContent = mode === 'courier' ? 'Ambil barang di' : 'Jemput di';
    $('lblDest').textContent = mode === 'courier' ? 'Antar ke' : 'Tujuan';
    $('btnOrder').textContent = mode === 'courier' ? 'Kirim sekarang' : 'Pesan sekarang';
    renderOptions();
  }

  // ---------- Overlay / pesanan ----------
  function openOverlay(html) {
    $('overlayBody').innerHTML = html;
    $('overlay').classList.remove('hidden');
  }
  function closeOverlay() {
    clearTimeout(findTimer);
    $('overlay').classList.add('hidden');
    $('overlayBody').innerHTML = '';
  }

  function kv(k, v) { return '<div class="kv"><span>' + esc(k) + '</span><span>' + v + '</span></div>'; }

  var draft = null;

  function showConfirm() {
    if (!state.route || state.routing) { return; }
    var svc = currentService();
    var d = {
      id: 'PC' + Date.now().toString(36).toUpperCase(),
      mode: state.mode,
      service: svc.name,
      icon: svc.icon,
      pickup: state.pickup.label,
      dest: state.dest.label,
      km: Math.round(state.route.distance / 100) / 10,
      minutes: Math.max(1, Math.round(state.route.duration / 60)),
      price: fare(svc, state.route.distance / 1000),
      time: Date.now(),
      status: 'searching'
    };
    if (state.mode === 'courier') {
      var name = $('receiverName').value.trim();
      var phone = $('receiverPhone').value.trim();
      if (name.length < 2) { toast('Isi nama penerima.'); $('receiverName').focus(); return; }
      if (!/^[0-9+\- ]{8,16}$/.test(phone)) { toast('Nomor HP penerima belum benar.'); $('receiverPhone').focus(); return; }
      d.item = $('itemType').value;
      d.receiver = name;
      d.phone = phone;
      d.note = $('note').value.trim();
    }
    draft = d;

    var html = '<h2>' + esc(d.icon) + ' Konfirmasi ' + (d.mode === 'courier' ? 'pengiriman' : 'pesanan') + '</h2>' +
      kv('Layanan', esc(d.service)) +
      kv(d.mode === 'courier' ? 'Ambil di' : 'Jemput', esc(d.pickup)) +
      kv(d.mode === 'courier' ? 'Antar ke' : 'Tujuan', esc(d.dest)) +
      kv('Jarak / waktu', esc(String(d.km).replace('.', ',')) + ' km · ' + d.minutes + ' mnt');
    if (d.mode === 'courier') {
      html += kv('Barang', esc(d.item)) + kv('Penerima', esc(d.receiver) + ' (' + esc(d.phone) + ')');
      if (d.note) { html += kv('Catatan', esc(d.note)); }
    }
    html += kv('Pembayaran', 'Tunai') + kv('Estimasi tarif', '<b>' + rupiah(d.price) + '</b>') +
      '<p class="note">Mode demo: pesanan ini hanya simulasi dan tidak dikirim ke driver sungguhan.</p>' +
      '<div class="btnrow"><button class="btn ghost" data-act="close" type="button">Batal</button>' +
      '<button class="btn primary" data-act="confirm" type="button">Pesan</button></div>';
    openOverlay(html);
  }

  function startSearching() {
    var o = draft;
    if (!o) { return; }
    upsertOrder(o);
    openOverlay('<div class="center"><div class="spinner"></div><h2>Mencari driver terdekat…</h2>' +
      '<p class="note">Simulasi · ' + esc(o.service) + ' · ' + rupiah(o.price) + '</p></div>' +
      '<div class="btnrow"><button class="btn danger" data-act="cancel" type="button">Batalkan pesanan</button></div>');
    clearTimeout(findTimer);
    findTimer = setTimeout(function () {
      o.status = 'demo-found';
      upsertOrder(o);
      openOverlay('<div class="center"><div class="ok">✅</div><h2>Driver ditemukan (simulasi)</h2></div>' +
        kv('Driver', 'Driver Demo') + kv('Kendaraan', esc(o.service) + ' · B 0000 DEMO') +
        kv('Estimasi tiba', (2 + Math.floor(Math.random() * 6)) + ' mnt') +
        '<p class="note">Ini hanya tampilan contoh. Untuk driver dan pembayaran sungguhan, aplikasi perlu dihubungkan ke server (backend).</p>' +
        '<div class="btnrow"><button class="btn primary" data-act="done" type="button">Selesai</button></div>');
    }, 3500);
  }

  function cancelOrder() {
    if (draft) { draft.status = 'cancelled'; upsertOrder(draft); }
    closeOverlay();
    toast('Pesanan dibatalkan.');
  }

  function statusText(s) {
    return s === 'cancelled' ? 'Dibatalkan' : (s === 'demo-found' ? 'Selesai (demo)' : 'Dibuat');
  }

  function showHistory() {
    var list = loadOrders();
    var html = '<h2>Riwayat pesanan</h2>';
    if (!list.length) {
      html += '<div class="empty">Belum ada pesanan.</div>';
    } else {
      list.forEach(function (o) {
        var dt = new Date(o.time);
        html += '<div class="hist"><div class="t"><span>' + esc(o.icon || '') + ' ' + esc(o.service) +
          '</span><span>' + rupiah(o.price) + '</span></div>' +
          '<small>' + esc(o.pickup) + ' → ' + esc(o.dest) + '</small>' +
          '<small>' + esc(dt.toLocaleString('id-ID')) + ' · ' + statusText(o.status) + ' · ' + esc(o.id) + '</small></div>';
      });
    }
    html += '<div class="btnrow">' +
      (list.length ? '<button class="btn danger" data-act="clearHistory" type="button">Hapus riwayat</button>' : '') +
      '<button class="btn ghost" data-act="close" type="button">Tutup</button></div>';
    openOverlay(html);
  }

  // ---------- Event ----------
  $('overlayBody').addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act]');
    if (!t) { return; }
    var act = t.getAttribute('data-act');
    if (act === 'close' || act === 'done') { closeOverlay(); }
    else if (act === 'confirm') { startSearching(); }
    else if (act === 'cancel') { cancelOrder(); }
    else if (act === 'clearHistory') { saveOrders([]); showHistory(); }
  });

  $('tabPassenger').addEventListener('click', function () { setMode('passenger'); });
  $('tabCourier').addEventListener('click', function () { setMode('courier'); });
  $('btnOrder').addEventListener('click', showConfirm);
  $('btnHistory').addEventListener('click', showHistory);
  $('btnLocate').addEventListener('click', function () { locate(false); });
  $('btnGps').addEventListener('click', function () { locate(false); });

  bindSearch('pickup');
  bindSearch('dest');

  map.on('click', function (e) {
    hideSuggestions();
    if (document.activeElement && document.activeElement.blur) { document.activeElement.blur(); }
    var kind = state.active === 'dest' ? 'dest' : 'pickup';
    setPoint(kind, { lat: e.latlng.lat, lng: e.latlng.lng }, null);
  });

  // ---------- Mulai ----------
  setMode('passenger');
  updateOrderBtn();
  locate(true);
})();
