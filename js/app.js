(function () {
  'use strict';

  var STORAGE_KEY = 'facturacion_v1';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_SHORT_LABEL = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  var PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Cheque', 'Tarjeta', 'Otro'];

  var state = loadState();
  var invoiceFilters = { search: '', status: 'all', from: '', to: '' };
  var clientFilter = '';
  var productFilter = '';
  var paymentFilters = { search: '', from: '', to: '' };

  // ---------- state ----------

  function defaultState() {
    return {
      settings: {
        companyName: '',
        ein: '',
        logo: null,
        taxRate: 0,
        dueDays: 15,
        invoicePrefix: 'INV-',
        nextInvoiceNumber: 1,
        backupReminderDays: 14,
        lastBackupAt: null
      },
      clients: [],
      products: [],
      invoices: [],
      bannerDismissedAt: null
    };
  }

  function loadState() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object') return defaultState();
    var base = defaultState();
    raw.settings = Object.assign(base.settings, raw.settings || {});
    raw.clients = raw.clients || [];
    raw.products = raw.products || [];
    raw.invoices = raw.invoices || [];
    return raw;
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- formatting ----------

  function money(n) {
    n = Number(n) || 0;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return '';
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function addDaysISO(iso, days) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + Number(days || 0));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- domain helpers ----------

  function getClient(id) { return state.clients.find(function (c) { return c.id === id; }); }
  function getProduct(id) { return state.products.find(function (p) { return p.id === id; }); }
  function getInvoice(id) { return state.invoices.find(function (i) { return i.id === id; }); }

  function invoiceSubtotal(inv) {
    return inv.items.reduce(function (sum, it) { return sum + (Number(it.qty) || 0) * (Number(it.price) || 0); }, 0);
  }
  function invoiceTaxAmount(inv) {
    return invoiceSubtotal(inv) * (Number(inv.taxRate) || 0) / 100;
  }
  function invoiceTotal(inv) {
    return invoiceSubtotal(inv) + invoiceTaxAmount(inv);
  }
  function invoicePaid(inv) {
    return (inv.payments || []).reduce(function (sum, p) { return sum + (Number(p.amount) || 0); }, 0);
  }
  function invoiceBalance(inv) {
    return Math.max(0, Math.round((invoiceTotal(inv) - invoicePaid(inv)) * 100) / 100);
  }
  function invoiceStatus(inv) {
    var balance = invoiceBalance(inv);
    if (balance <= 0.004) return 'paid';
    if (inv.dueDate && inv.dueDate < todayISO()) return 'overdue';
    return 'pending';
  }
  function statusLabel(s) {
    return { paid: 'Pagada', pending: 'Pendiente', overdue: 'Vencida' }[s] || s;
  }
  function statusBadge(s) {
    return '<span class="badge badge-' + s + '">' + statusLabel(s) + '</span>';
  }

  function clientBalance(clientId) {
    return state.invoices
      .filter(function (i) { return i.clientId === clientId; })
      .reduce(function (sum, i) { return sum + invoiceBalance(i); }, 0);
  }

  function nextFolioPreview() {
    return state.settings.invoicePrefix + String(state.settings.nextInvoiceNumber).padStart(4, '0');
  }

  // ---------- routing ----------

  var VIEWS = ['dashboard', 'invoices', 'clients', 'catalog', 'payments', 'settings'];

  function currentViewFromHash() {
    var h = (location.hash || '').replace('#', '');
    return VIEWS.indexOf(h) >= 0 ? h : 'dashboard';
  }

  function setView(name) {
    VIEWS.forEach(function (v) {
      document.getElementById('view-' + v).classList.toggle('active', v === name);
    });
    document.querySelectorAll('#sidenav a').forEach(function (a) {
      a.classList.toggle('active', a.dataset.view === name);
    });
    renderView(name);
  }

  function renderView(name) {
    if (name === 'dashboard') renderDashboard();
    else if (name === 'invoices') renderInvoices();
    else if (name === 'clients') renderClients();
    else if (name === 'catalog') renderCatalog();
    else if (name === 'payments') renderPayments();
    else if (name === 'settings') renderSettings();
  }

  // ---------- dashboard ----------

  function renderDashboard() {
    var now = new Date();
    var monthKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

    var invoicedThisMonth = 0, overdueCount = 0, pendingTotal = 0, collectedThisMonth = 0;
    state.invoices.forEach(function (inv) {
      if ((inv.issueDate || '').slice(0, 7) === monthKey) invoicedThisMonth += invoiceTotal(inv);
      var status = invoiceStatus(inv);
      if (status === 'overdue') overdueCount++;
      if (status !== 'paid') pendingTotal += invoiceBalance(inv);
      (inv.payments || []).forEach(function (p) {
        if ((p.date || '').slice(0, 7) === monthKey) collectedThisMonth += Number(p.amount) || 0;
      });
    });

    document.getElementById('kpi-invoiced').textContent = money(invoicedThisMonth);
    document.getElementById('kpi-collected').textContent = money(collectedThisMonth);
    document.getElementById('kpi-pending').textContent = money(pendingTotal);
    document.getElementById('kpi-overdue').textContent = String(overdueCount);

    renderRevenueChart();
    renderTopClients();
    renderDashInvoicesTable();
  }

  function renderRevenueChart() {
    var now = new Date();
    var months = [];
    for (var i = 5; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), label: MONTHS_SHORT_LABEL[d.getMonth()] });
    }
    var totals = months.map(function (m) {
      return state.invoices.reduce(function (sum, inv) {
        return (inv.issueDate || '').slice(0, 7) === m.key ? sum + invoiceTotal(inv) : sum;
      }, 0);
    });
    var max = Math.max.apply(null, totals.concat([1]));
    var el = document.getElementById('revenue-chart');
    el.innerHTML = months.map(function (m, idx) {
      var h = Math.max(4, Math.round((totals[idx] / max) * 120));
      var isCurrent = idx === months.length - 1;
      return '<div class="chart-bar-wrap">' +
        '<div class="chart-value">' + money(totals[idx]).replace('.00', '') + '</div>' +
        '<div class="chart-bar' + (isCurrent ? ' current' : '') + '" style="height:' + h + 'px"></div>' +
        '<div class="chart-label">' + m.label + '</div>' +
        '</div>';
    }).join('');
  }

  function renderTopClients() {
    var totals = {};
    state.invoices.forEach(function (inv) {
      totals[inv.clientId] = (totals[inv.clientId] || 0) + invoiceTotal(inv);
    });
    var rows = Object.keys(totals).map(function (id) {
      var c = getClient(id);
      return { name: c ? c.name : 'Cliente eliminado', total: totals[id] };
    }).sort(function (a, b) { return b.total - a.total; }).slice(0, 5);
    var el = document.getElementById('top-clients');
    if (!rows.length) { el.innerHTML = '<p class="empty-state">Aún no hay facturas.</p>'; return; }
    el.innerHTML = rows.map(function (r) {
      return '<div class="stack-row"><span>' + escapeHTML(r.name) + '</span><span>' + money(r.total) + '</span></div>';
    }).join('');
  }

  function renderDashInvoicesTable() {
    var rows = state.invoices.slice().sort(function (a, b) { return (b.issueDate || '').localeCompare(a.issueDate || ''); }).slice(0, 5);
    var tbody = document.querySelector('#dash-invoices-table tbody');
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Aún no hay facturas.</td></tr>'; return; }
    tbody.innerHTML = rows.map(function (inv) {
      var c = getClient(inv.clientId);
      var status = invoiceStatus(inv);
      return '<tr data-open-invoice="' + inv.id + '">' +
        '<td class="mono">' + escapeHTML(inv.number) + '</td>' +
        '<td>' + escapeHTML(c ? c.name : '—') + '</td>' +
        '<td>' + fmtDate(inv.dueDate) + '</td>' +
        '<td class="num">' + money(invoiceTotal(inv)) + '</td>' +
        '<td class="num">' + money(invoiceBalance(inv)) + '</td>' +
        '<td>' + statusBadge(status) + '</td>' +
        '</tr>';
    }).join('');
  }

  // ---------- invoices view ----------

  function filteredInvoices() {
    var q = invoiceFilters.search.trim().toLowerCase();
    return state.invoices.filter(function (inv) {
      var c = getClient(inv.clientId);
      if (q) {
        var hay = (inv.number + ' ' + (c ? c.name : '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      if (invoiceFilters.status !== 'all' && invoiceStatus(inv) !== invoiceFilters.status) return false;
      if (invoiceFilters.from && inv.issueDate < invoiceFilters.from) return false;
      if (invoiceFilters.to && inv.issueDate > invoiceFilters.to) return false;
      return true;
    }).sort(function (a, b) { return (b.issueDate || '').localeCompare(a.issueDate || '') || b.number.localeCompare(a.number); });
  }

  function renderInvoices() {
    var rows = filteredInvoices();
    var tbody = document.querySelector('#invoices-table tbody');
    document.getElementById('invoices-empty').hidden = rows.length > 0;
    tbody.innerHTML = rows.map(function (inv) {
      var c = getClient(inv.clientId);
      var status = invoiceStatus(inv);
      return '<tr data-open-invoice="' + inv.id + '">' +
        '<td class="mono">' + escapeHTML(inv.number) + '</td>' +
        '<td>' + escapeHTML(c ? c.name : '—') + '</td>' +
        '<td>' + fmtDate(inv.issueDate) + '</td>' +
        '<td>' + fmtDate(inv.dueDate) + '</td>' +
        '<td class="num">' + money(invoiceTotal(inv)) + '</td>' +
        '<td class="num">' + money(invoiceBalance(inv)) + '</td>' +
        '<td>' + statusBadge(status) + '</td>' +
        '<td><button type="button" class="btn-icon" data-delete-invoice="' + inv.id + '" aria-label="Eliminar factura">🗑</button></td>' +
        '</tr>';
    }).join('');
  }

  function invoiceExportRows(format) {
    var rows = filteredInvoices();
    if (format === 'csv-quickbooks') {
      var out = [];
      rows.forEach(function (inv) {
        var c = getClient(inv.clientId);
        inv.items.forEach(function (it) {
          out.push({
            InvoiceNo: inv.number,
            Customer: c ? c.name : '',
            InvoiceDate: inv.issueDate,
            DueDate: inv.dueDate,
            Item: it.description,
            ItemDescription: it.description,
            ItemQuantity: it.qty,
            ItemRate: it.price,
            ItemAmount: Math.round(it.qty * it.price * 100) / 100,
            Currency: 'USD'
          });
        });
      });
      return out;
    }
    return rows.map(function (inv) {
      var c = getClient(inv.clientId);
      return {
        Folio: inv.number,
        Cliente: c ? c.name : '',
        Correo: c ? c.email : '',
        FechaEmision: inv.issueDate,
        FechaVencimiento: inv.dueDate,
        Subtotal: Math.round(invoiceSubtotal(inv) * 100) / 100,
        SalesTax: Math.round(invoiceTaxAmount(inv) * 100) / 100,
        Total: Math.round(invoiceTotal(inv) * 100) / 100,
        Pagado: Math.round(invoicePaid(inv) * 100) / 100,
        Saldo: invoiceBalance(inv),
        Estado: statusLabel(invoiceStatus(inv))
      };
    });
  }

  function exportInvoices(format) {
    var rows = invoiceExportRows(format);
    if (!rows.length) { toast('No hay facturas para exportar con estos filtros.'); return; }
    var ws = XLSX.utils.json_to_sheet(rows);
    if (format === 'xlsx') {
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Facturas');
      XLSX.writeFile(wb, 'facturas.xlsx');
    } else {
      var csv = XLSX.utils.sheet_to_csv(ws);
      downloadBlob(csv, format === 'csv-quickbooks' ? 'facturas-quickbooks.csv' : 'facturas.csv', 'text/csv;charset=utf-8;');
    }
  }

  function downloadBlob(content, filename, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------- clients view ----------

  function filteredClients() {
    var q = clientFilter.trim().toLowerCase();
    return state.clients.filter(function (c) {
      if (!q) return true;
      return (c.name + ' ' + c.email + ' ' + c.phone).toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function renderClients() {
    var rows = filteredClients();
    document.getElementById('clients-empty').hidden = rows.length > 0;
    document.querySelector('#clients-table tbody').innerHTML = rows.map(function (c) {
      return '<tr data-open-client="' + c.id + '">' +
        '<td>' + escapeHTML(c.name) + '</td>' +
        '<td>' + escapeHTML(c.email) + '</td>' +
        '<td>' + escapeHTML(c.phone) + '</td>' +
        '<td class="mono">' + escapeHTML(c.taxId) + '</td>' +
        '<td class="num">' + money(clientBalance(c.id)) + '</td>' +
        '<td><button type="button" class="btn-icon" data-delete-client="' + c.id + '" aria-label="Eliminar cliente">🗑</button></td>' +
        '</tr>';
    }).join('');
  }

  // ---------- catalog view ----------

  function filteredProducts() {
    var q = productFilter.trim().toLowerCase();
    return state.products.filter(function (p) {
      return !q || p.name.toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function renderCatalog() {
    var rows = filteredProducts();
    document.getElementById('catalog-empty').hidden = rows.length > 0;
    document.querySelector('#catalog-table tbody').innerHTML = rows.map(function (p) {
      return '<tr data-open-product="' + p.id + '">' +
        '<td>' + escapeHTML(p.name) + '</td>' +
        '<td>' + escapeHTML(p.description) + '</td>' +
        '<td class="num">' + money(p.price) + '</td>' +
        '<td><button type="button" class="btn-icon" data-delete-product="' + p.id + '" aria-label="Eliminar producto">🗑</button></td>' +
        '</tr>';
    }).join('');
  }

  // ---------- payments view ----------

  function allPayments() {
    var list = [];
    state.invoices.forEach(function (inv) {
      var c = getClient(inv.clientId);
      (inv.payments || []).forEach(function (p) {
        list.push({ date: p.date, amount: p.amount, method: p.method, invoiceNumber: inv.number, clientName: c ? c.name : '—' });
      });
    });
    return list.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  }

  function renderPayments() {
    var q = paymentFilters.search.trim().toLowerCase();
    var rows = allPayments().filter(function (p) {
      if (q && (p.clientName + ' ' + p.invoiceNumber).toLowerCase().indexOf(q) === -1) return false;
      if (paymentFilters.from && p.date < paymentFilters.from) return false;
      if (paymentFilters.to && p.date > paymentFilters.to) return false;
      return true;
    });
    document.getElementById('payments-empty').hidden = rows.length > 0;
    document.querySelector('#payments-table tbody').innerHTML = rows.map(function (p) {
      return '<tr>' +
        '<td>' + fmtDate(p.date) + '</td>' +
        '<td class="mono">' + escapeHTML(p.invoiceNumber) + '</td>' +
        '<td>' + escapeHTML(p.clientName) + '</td>' +
        '<td>' + escapeHTML(p.method) + '</td>' +
        '<td class="num">' + money(p.amount) + '</td>' +
        '</tr>';
    }).join('');
  }

  // ---------- settings view ----------

  function renderSettings() {
    var s = state.settings;
    var companyForm = document.getElementById('settings-company-form');
    companyForm.companyName.value = s.companyName || '';
    companyForm.ein.value = s.ein || '';
    var previewWrap = document.getElementById('logo-preview-wrap');
    if (s.logo) {
      previewWrap.hidden = false;
      document.getElementById('logo-preview').src = s.logo;
    } else {
      previewWrap.hidden = true;
    }

    var invForm = document.getElementById('settings-invoicing-form');
    invForm.taxRate.value = s.taxRate;
    invForm.dueDays.value = s.dueDays;
    invForm.invoicePrefix.value = s.invoicePrefix;
    invForm.nextInvoiceNumber.value = s.nextInvoiceNumber;
    document.getElementById('folio-preview').textContent = nextFolioPreview();

    document.getElementById('settings-backup-form').backupReminderDays.value = s.backupReminderDays;
    document.getElementById('last-backup-line').textContent = s.lastBackupAt
      ? 'Último respaldo: ' + fmtDate(s.lastBackupAt.slice(0, 10)) + ' a las ' + new Date(s.lastBackupAt).toLocaleTimeString('en-US')
      : 'Todavía no has exportado un respaldo.';
  }

  function readImageAsResizedDataURL(file, maxSize) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var img = new Image();
        img.onerror = reject;
        img.onload = function () {
          var ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
          var w = Math.round(img.width * ratio), h = Math.round(img.height * ratio);
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/png'));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ---------- backup ----------

  function exportBackup() {
    var data = JSON.stringify(state, null, 2);
    var stamp = todayISO();
    downloadBlob(data, 'facturacion-respaldo-' + stamp + '.json', 'application/json');
    state.settings.lastBackupAt = new Date().toISOString();
    saveState();
    renderSettings();
    updateBackupBanner();
    toast('Respaldo exportado.');
  }

  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(reader.result); } catch (e) {
        toast('El archivo no es un respaldo válido.');
        return;
      }
      if (!parsed || !parsed.settings || !parsed.clients || !parsed.invoices) {
        toast('El archivo no tiene el formato esperado.');
        return;
      }
      if (!confirm('Esto reemplaza todos los datos actuales de este navegador con los del respaldo. ¿Continuar?')) return;
      state = parsed;
      state.products = state.products || [];
      saveState();
      renderView(currentViewFromHash());
      applyBrand();
      updateBackupBanner();
      toast('Respaldo importado.');
    };
    reader.readAsText(file);
  }

  function updateBackupBanner() {
    var banner = document.getElementById('backup-banner');
    var s = state.settings;
    if (!s.lastBackupAt) {
      var hasData = state.invoices.length || state.clients.length;
      if (!hasData) { banner.hidden = true; return; }
    }
    var days = s.lastBackupAt ? (Date.now() - new Date(s.lastBackupAt).getTime()) / 86400000 : Infinity;
    var dismissedRecently = state.bannerDismissedAt && (Date.now() - state.bannerDismissedAt) < 86400000;
    if (days >= (s.backupReminderDays || 14) && !dismissedRecently) {
      banner.hidden = false;
      banner.querySelector('span').textContent = s.lastBackupAt
        ? 'No respaldas tus datos hace ' + Math.floor(days) + ' días.'
        : 'Aún no has hecho un respaldo de tus datos.';
    } else {
      banner.hidden = true;
    }
  }

  // ---------- brand ----------

  function applyBrand() {
    document.getElementById('brand-name').textContent = state.settings.companyName || 'Facturación';
    var logoEl = document.getElementById('brand-logo');
    if (state.settings.logo) { logoEl.src = state.settings.logo; logoEl.hidden = false; }
    else { logoEl.hidden = true; }
  }

  // ---------- toast ----------

  function toast(msg) {
    var root = document.getElementById('toast-root');
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.remove(); }, 3200);
  }

  // ---------- modal shell ----------

  function openModal(innerHTML) {
    var root = document.getElementById('modal-root');
    root.innerHTML = '<div class="modal-overlay"><div class="modal">' + innerHTML + '</div></div>';
    root.querySelector('.modal-overlay').addEventListener('mousedown', function (e) {
      if (e.target === this) closeModal();
    });
  }
  function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

  // ---------- client modal ----------

  function openClientModal(client) {
    var isEdit = !!client;
    client = client || { name: '', email: '', phone: '', taxId: '', address: '' };
    openModal(
      '<div class="modal-header"><h2>' + (isEdit ? 'Editar cliente' : 'Nuevo cliente') + '</h2>' +
      '<button type="button" class="modal-close" data-close aria-label="Cerrar">×</button></div>' +
      '<form id="client-form" class="form-grid" style="max-width:none;">' +
      '<label>Nombre<input type="text" name="name" required value="' + escapeHTML(client.name) + '"></label>' +
      '<label>Correo<input type="email" name="email" value="' + escapeHTML(client.email) + '"></label>' +
      '<label>Teléfono<input type="text" name="phone" value="' + escapeHTML(client.phone) + '"></label>' +
      '<label>EIN / Tax ID<input type="text" name="taxId" value="' + escapeHTML(client.taxId) + '"></label>' +
      '<label>Dirección<input type="text" name="address" value="' + escapeHTML(client.address) + '"></label>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" data-close>Cancelar</button>' +
      '<button type="submit" class="btn btn-primary">Guardar</button>' +
      '</div></form>'
    );
    document.getElementById('client-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(this);
      var data = { name: fd.get('name').trim(), email: fd.get('email').trim(), phone: fd.get('phone').trim(), taxId: fd.get('taxId').trim(), address: fd.get('address').trim() };
      if (!data.name) return;
      if (isEdit) { Object.assign(client, data); }
      else { data.id = uid(); data.createdAt = todayISO(); state.clients.push(data); }
      saveState();
      closeModal();
      renderView(currentViewFromHash());
      toast('Cliente guardado.');
    });
  }

  function deleteClient(id) {
    var used = state.invoices.some(function (i) { return i.clientId === id; });
    if (used) { toast('No se puede eliminar: tiene facturas asociadas.'); return; }
    if (!confirm('¿Eliminar este cliente?')) return;
    state.clients = state.clients.filter(function (c) { return c.id !== id; });
    saveState();
    renderClients();
  }

  // ---------- product modal ----------

  function openProductModal(product) {
    var isEdit = !!product;
    product = product || { name: '', description: '', price: '' };
    openModal(
      '<div class="modal-header"><h2>' + (isEdit ? 'Editar producto' : 'Nuevo producto o servicio') + '</h2>' +
      '<button type="button" class="modal-close" data-close aria-label="Cerrar">×</button></div>' +
      '<form id="product-form" class="form-grid" style="max-width:none;">' +
      '<label>Nombre<input type="text" name="name" required value="' + escapeHTML(product.name) + '"></label>' +
      '<label>Descripción<input type="text" name="description" value="' + escapeHTML(product.description) + '"></label>' +
      '<label>Precio<input type="number" name="price" min="0" step="0.01" required value="' + escapeHTML(product.price) + '"></label>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" data-close>Cancelar</button>' +
      '<button type="submit" class="btn btn-primary">Guardar</button>' +
      '</div></form>'
    );
    document.getElementById('product-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(this);
      var data = { name: fd.get('name').trim(), description: fd.get('description').trim(), price: Number(fd.get('price')) || 0 };
      if (!data.name) return;
      if (isEdit) { Object.assign(product, data); }
      else { data.id = uid(); state.products.push(data); }
      saveState();
      closeModal();
      renderCatalog();
      toast('Producto guardado.');
    });
  }

  function deleteProduct(id) {
    if (!confirm('¿Eliminar este producto del catálogo?')) return;
    state.products = state.products.filter(function (p) { return p.id !== id; });
    saveState();
    renderCatalog();
  }

  // ---------- invoice modal ----------

  var draftItems = [];

  function blankItem() {
    return { catalogId: '', description: '', qty: 1, price: 0 };
  }

  function openInvoiceModal(invoice) {
    var isEdit = !!invoice;
    if (!state.clients.length) {
      toast('Primero agrega al menos un cliente.');
      return;
    }
    draftItems = isEdit ? invoice.items.map(function (it) { return Object.assign({}, it); }) : [blankItem()];
    var issueDate = isEdit ? invoice.issueDate : todayISO();
    var dueDate = isEdit ? invoice.dueDate : addDaysISO(issueDate, state.settings.dueDays);
    var taxRate = isEdit ? invoice.taxRate : state.settings.taxRate;
    var clientId = isEdit ? invoice.clientId : state.clients[0].id;

    var html = '<div class="modal-header"><h2>' + (isEdit ? 'Factura ' + escapeHTML(invoice.number) : 'Nueva factura') + '</h2>' +
      '<button type="button" class="modal-close" data-close aria-label="Cerrar">×</button></div>' +
      '<form id="invoice-form">' +
      '<div class="form-grid" style="max-width:none;">' +
      '<label>Cliente<select name="clientId">' + state.clients.map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === clientId ? ' selected' : '') + '>' + escapeHTML(c.name) + '</option>';
      }).join('') + '</select></label>' +
      '<div style="display:flex;gap:14px;">' +
      '<label style="flex:1;">Emitida<input type="date" name="issueDate" value="' + issueDate + '"></label>' +
      '<label style="flex:1;">Vence<input type="date" name="dueDate" value="' + dueDate + '"></label>' +
      '<label style="flex:1;">Sales tax %<input type="number" name="taxRate" min="0" max="100" step="0.001" value="' + taxRate + '"></label>' +
      '</div></div>' +
      '<div class="modal-section"><h3>Conceptos</h3>' +
      '<table class="line-items-table" id="line-items-table"><thead><tr><th>Producto</th><th>Descripción</th><th>Cant.</th><th>Precio</th><th>Total</th><th></th></tr></thead>' +
      '<tbody id="line-items-body"></tbody></table>' +
      '<button type="button" class="btn btn-ghost btn-small" id="add-line-btn">+ Agregar línea</button>' +
      '<div class="totals-block" id="totals-block"></div>' +
      '</div>';

    if (isEdit) {
      html += '<div class="modal-section"><h3>Pagos</h3>' +
        '<div class="payments-list" id="payments-list"></div>' +
        '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">' +
        '<label style="font-size:12px;font-weight:600;">Fecha<input type="date" id="payment-date" value="' + todayISO() + '" style="display:block;padding:8px;border:1px solid var(--line);border-radius:6px;"></label>' +
        '<label style="font-size:12px;font-weight:600;">Monto<input type="number" id="payment-amount" min="0" step="0.01" style="display:block;padding:8px;border:1px solid var(--line);border-radius:6px;width:110px;"></label>' +
        '<label style="font-size:12px;font-weight:600;">Método<select id="payment-method" style="display:block;padding:8px;border:1px solid var(--line);border-radius:6px;">' +
        PAYMENT_METHODS.map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join('') + '</select></label>' +
        '<button type="button" class="btn btn-ghost btn-small" id="add-payment-btn">+ Registrar pago</button>' +
        '</div>' +
        '<div class="balance-line" id="balance-line"></div>' +
        '</div>';
    }

    html += '<div class="modal-actions">';
    if (isEdit) html += '<button type="button" class="btn btn-ghost" id="download-pdf-btn">Descargar PDF</button>' +
      '<button type="button" class="btn btn-danger" id="delete-invoice-btn">Eliminar</button>';
    html += '<button type="button" class="btn btn-ghost" data-close>Cancelar</button>' +
      '<button type="submit" class="btn btn-primary">Guardar</button>' +
      '</div></form>';

    openModal(html);

    var form = document.getElementById('invoice-form');

    function renderLineItems() {
      document.getElementById('line-items-body').innerHTML = draftItems.map(function (item, idx) {
        var options = '<option value="">Personalizado</option>' + state.products.map(function (p) {
          return '<option value="' + p.id + '"' + (item.catalogId === p.id ? ' selected' : '') + '>' + escapeHTML(p.name) + '</option>';
        }).join('');
        return '<tr data-idx="' + idx + '">' +
          '<td><select class="li-catalog">' + options + '</select></td>' +
          '<td><input type="text" class="li-desc" value="' + escapeHTML(item.description) + '"></td>' +
          '<td><input type="number" class="li-qty qty" min="0" step="0.01" value="' + item.qty + '"></td>' +
          '<td><input type="number" class="li-price price" min="0" step="0.01" value="' + item.price + '"></td>' +
          '<td class="num">' + money((Number(item.qty) || 0) * (Number(item.price) || 0)) + '</td>' +
          '<td><button type="button" class="line-item-remove" data-remove="' + idx + '" aria-label="Quitar línea">×</button></td>' +
          '</tr>';
      }).join('');
      renderTotals();
    }

    function renderTotals() {
      var subtotal = draftItems.reduce(function (s, it) { return s + (Number(it.qty) || 0) * (Number(it.price) || 0); }, 0);
      var rate = Number(form.taxRate.value) || 0;
      var tax = subtotal * rate / 100;
      document.getElementById('totals-block').innerHTML =
        '<div class="totals-row"><span>Subtotal</span><span>' + money(subtotal) + '</span></div>' +
        '<div class="totals-row"><span>Sales tax (' + rate + '%)</span><span>' + money(tax) + '</span></div>' +
        '<div class="totals-row grand"><span>Total</span><span>' + money(subtotal + tax) + '</span></div>';
    }

    function renderPaymentsSection() {
      if (!isEdit) return;
      var list = document.getElementById('payments-list');
      var payments = invoice.payments || [];
      list.innerHTML = payments.length ? payments.map(function (p, idx) {
        return '<div class="payment-row"><span>' + fmtDate(p.date) + ' · ' + escapeHTML(p.method) + '</span>' +
          '<span>' + money(p.amount) + ' <button type="button" class="btn-icon" data-remove-payment="' + idx + '" aria-label="Quitar pago">🗑</button></span></div>';
      }).join('') : '<p class="field-hint">Sin pagos registrados todavía.</p>';
      var subtotal = draftItems.reduce(function (s, it) { return s + (Number(it.qty) || 0) * (Number(it.price) || 0); }, 0);
      var rate = Number(form.taxRate.value) || 0;
      var total = subtotal + subtotal * rate / 100;
      var paid = payments.reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0);
      var balance = Math.max(0, Math.round((total - paid) * 100) / 100);
      var line = document.getElementById('balance-line');
      line.className = 'balance-line ' + (balance <= 0.004 ? 'settled' : 'owed');
      line.innerHTML = '<span>Saldo pendiente</span><span>' + money(balance) + '</span>';
      document.getElementById('payment-amount').value = balance > 0 ? balance : '';
    }

    renderLineItems();
    renderPaymentsSection();

    form.addEventListener('input', function (e) {
      var tr = e.target.closest('tr[data-idx]');
      if (tr) {
        var idx = Number(tr.dataset.idx);
        if (e.target.classList.contains('li-desc')) draftItems[idx].description = e.target.value;
        if (e.target.classList.contains('li-qty')) draftItems[idx].qty = e.target.value;
        if (e.target.classList.contains('li-price')) draftItems[idx].price = e.target.value;
        tr.querySelector('.num').textContent = money((Number(draftItems[idx].qty) || 0) * (Number(draftItems[idx].price) || 0));
      }
      if (e.target.name === 'taxRate') { renderTotals(); renderPaymentsSection(); }
    });

    form.addEventListener('change', function (e) {
      if (e.target.classList.contains('li-catalog')) {
        var tr = e.target.closest('tr[data-idx]');
        var idx = Number(tr.dataset.idx);
        var pid = e.target.value;
        draftItems[idx].catalogId = pid;
        if (pid) {
          var p = getProduct(pid);
          if (p) { draftItems[idx].description = p.description || p.name; draftItems[idx].price = p.price; }
        }
        renderLineItems();
      }
    });

    document.getElementById('add-line-btn').addEventListener('click', function () {
      draftItems.push(blankItem());
      renderLineItems();
    });

    form.addEventListener('click', function (e) {
      var idx = e.target.dataset.remove;
      if (idx !== undefined) {
        draftItems.splice(Number(idx), 1);
        if (!draftItems.length) draftItems.push(blankItem());
        renderLineItems();
      }
      var pidx = e.target.dataset.removePayment;
      if (pidx !== undefined) {
        invoice.payments.splice(Number(pidx), 1);
        saveState();
        renderPaymentsSection();
        renderView('invoices');
      }
    });

    if (isEdit) {
      document.getElementById('add-payment-btn').addEventListener('click', function () {
        var amount = Number(document.getElementById('payment-amount').value);
        if (!amount || amount <= 0) { toast('Ingresa un monto válido.'); return; }
        invoice.payments = invoice.payments || [];
        invoice.payments.push({ date: document.getElementById('payment-date').value || todayISO(), amount: amount, method: document.getElementById('payment-method').value });
        saveState();
        renderPaymentsSection();
        renderView('invoices');
        toast('Pago registrado.');
      });
      document.getElementById('download-pdf-btn').addEventListener('click', function () { downloadInvoicePDF(invoice); });
      document.getElementById('delete-invoice-btn').addEventListener('click', function () {
        if (!confirm('¿Eliminar esta factura? Esta acción no se puede deshacer.')) return;
        state.invoices = state.invoices.filter(function (i) { return i.id !== invoice.id; });
        saveState();
        closeModal();
        renderView(currentViewFromHash());
        toast('Factura eliminada.');
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var items = draftItems
        .map(function (it) { return { catalogId: it.catalogId || '', description: (it.description || '').trim(), qty: Number(it.qty) || 0, price: Number(it.price) || 0 }; })
        .filter(function (it) { return it.description && it.qty > 0; });
      if (!items.length) { toast('Agrega al menos un concepto válido.'); return; }
      var payload = {
        clientId: fd.get('clientId'),
        issueDate: fd.get('issueDate'),
        dueDate: fd.get('dueDate'),
        taxRate: Number(fd.get('taxRate')) || 0,
        items: items
      };
      if (isEdit) {
        Object.assign(invoice, payload);
      } else {
        payload.id = uid();
        payload.number = nextFolioPreview();
        payload.payments = [];
        state.settings.nextInvoiceNumber += 1;
        state.invoices.push(payload);
      }
      saveState();
      closeModal();
      renderView(currentViewFromHash());
      toast('Factura guardada.');
    });
  }

  // ---------- pdf ----------

  function downloadInvoicePDF(inv) {
    var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) { toast('No se pudo generar el PDF.'); return; }
    var doc = new jsPDFCtor({ unit: 'pt', format: 'letter' });
    var c = getClient(inv.clientId);
    var s = state.settings;
    var marginX = 40;
    var y = 50;

    if (s.logo) {
      try { doc.addImage(s.logo, 'PNG', marginX, y - 10, 42, 42); } catch (e) {}
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(s.companyName || 'Company', s.logo ? marginX + 54 : marginX, y + 10);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    if (s.ein) doc.text('EIN: ' + s.ein, s.logo ? marginX + 54 : marginX, y + 26);

    doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
    doc.text('INVOICE', 555, y + 10, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text('Invoice #: ' + inv.number, 555, y + 30, { align: 'right' });
    doc.text('Issued: ' + fmtDateEN(inv.issueDate), 555, y + 44, { align: 'right' });
    doc.text('Due: ' + fmtDateEN(inv.dueDate), 555, y + 58, { align: 'right' });

    y += 80;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('Bill To', marginX, y);
    doc.setFont('helvetica', 'normal');
    var lines = [c ? c.name : ''];
    if (c && c.address) lines.push(c.address);
    if (c && c.email) lines.push(c.email);
    if (c && c.taxId) lines.push('Tax ID: ' + c.taxId);
    lines.forEach(function (line, i) { doc.text(line, marginX, y + 16 + i * 14); });

    y += 16 + lines.length * 14 + 20;

    var body = inv.items.map(function (it) {
      return [it.description, String(it.qty), money(it.price), money(it.qty * it.price)];
    });
    doc.autoTable({
      startY: y,
      margin: { left: marginX, right: marginX },
      head: [['Description', 'Qty', 'Rate', 'Amount']],
      body: body,
      styles: { font: 'helvetica', fontSize: 10 },
      headStyles: { fillColor: [28, 27, 24] }
    });

    var afterTableY = doc.lastAutoTable.finalY + 20;
    var subtotal = invoiceSubtotal(inv), tax = invoiceTaxAmount(inv), total = invoiceTotal(inv), balance = invoiceBalance(inv);
    var rows = [
      ['Subtotal', money(subtotal)],
      ['Sales tax (' + inv.taxRate + '%)', money(tax)],
      ['Total', money(total)]
    ];
    if (invoicePaid(inv) > 0) rows.push(['Balance due', money(balance)]);
    doc.setFontSize(10);
    rows.forEach(function (r, i) {
      var rowY = afterTableY + i * 16;
      doc.setFont('helvetica', i === rows.length - 1 || r[0] === 'Total' ? 'bold' : 'normal');
      doc.text(r[0], 420, rowY);
      doc.text(r[1], 555, rowY, { align: 'right' });
    });

    doc.save(inv.number + '.pdf');
  }

  function fmtDateEN(iso) { return fmtDate(iso); }

  // ---------- onboarding ----------

  function needsOnboarding() { return !state.settings.companyName; }

  function openOnboarding() {
    openModal(
      '<div class="modal-header"><h2>Bienvenido</h2></div>' +
      '<p class="field-hint">Antes de empezar, cuéntanos sobre tu compañía. Puedes cambiar esto luego en Ajustes.</p>' +
      '<form id="onboarding-form" class="form-grid" style="max-width:none;">' +
      '<label>Nombre de la compañía<input type="text" name="companyName" required></label>' +
      '<label>EIN / Tax ID (opcional)<input type="text" name="ein" placeholder="12-3456789"></label>' +
      '<label>Tasa de sales tax por defecto (%)<input type="number" name="taxRate" min="0" max="100" step="0.001" value="0" required></label>' +
      '<div class="modal-actions"><button type="submit" class="btn btn-primary">Empezar</button></div>' +
      '</form>'
    );
    document.querySelector('.modal-overlay').style.pointerEvents = 'auto';
    document.getElementById('onboarding-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(this);
      state.settings.companyName = fd.get('companyName').trim();
      state.settings.ein = fd.get('ein').trim();
      state.settings.taxRate = Number(fd.get('taxRate')) || 0;
      saveState();
      closeModal();
      applyBrand();
      renderView(currentViewFromHash());
    });
  }

  // ---------- global event wiring ----------

  function wireEvents() {
    document.getElementById('sidenav').addEventListener('click', function (e) {
      var a = e.target.closest('a[data-view]');
      if (a) { location.hash = a.dataset.view; }
    });
    window.addEventListener('hashchange', function () { setView(currentViewFromHash()); });

    document.getElementById('new-invoice-btn').addEventListener('click', function () { openInvoiceModal(null); });
    document.getElementById('new-client-btn').addEventListener('click', function () { openClientModal(null); });
    document.getElementById('new-product-btn').addEventListener('click', function () { openProductModal(null); });

    document.getElementById('views').addEventListener('click', function (e) {
      var invRow = e.target.closest('[data-open-invoice]');
      var delInv = e.target.closest('[data-delete-invoice]');
      var cliRow = e.target.closest('[data-open-client]');
      var delCli = e.target.closest('[data-delete-client]');
      var prodRow = e.target.closest('[data-open-product]');
      var delProd = e.target.closest('[data-delete-product]');
      if (delInv) {
        e.stopPropagation();
        if (confirm('¿Eliminar esta factura?')) {
          state.invoices = state.invoices.filter(function (i) { return i.id !== delInv.dataset.deleteInvoice; });
          saveState();
          renderView(currentViewFromHash());
        }
        return;
      }
      if (delCli) { e.stopPropagation(); deleteClient(delCli.dataset.deleteClient); return; }
      if (delProd) { e.stopPropagation(); deleteProduct(delProd.dataset.deleteProduct); return; }
      if (invRow) { openInvoiceModal(getInvoice(invRow.dataset.openInvoice)); return; }
      if (cliRow) { openClientModal(getClient(cliRow.dataset.openClient)); return; }
      if (prodRow) { openProductModal(getProduct(prodRow.dataset.openProduct)); return; }
    });

    document.getElementById('modal-root').addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) closeModal();
    });

    document.getElementById('invoice-search').addEventListener('input', function (e) { invoiceFilters.search = e.target.value; renderInvoices(); });
    document.getElementById('invoice-status-filter').addEventListener('change', function (e) { invoiceFilters.status = e.target.value; renderInvoices(); });
    document.getElementById('invoice-from').addEventListener('change', function (e) { invoiceFilters.from = e.target.value; renderInvoices(); });
    document.getElementById('invoice-to').addEventListener('change', function (e) { invoiceFilters.to = e.target.value; renderInvoices(); });
    document.getElementById('invoice-filter-clear').addEventListener('click', function () {
      invoiceFilters = { search: '', status: 'all', from: '', to: '' };
      document.getElementById('invoice-search').value = '';
      document.getElementById('invoice-status-filter').value = 'all';
      document.getElementById('invoice-from').value = '';
      document.getElementById('invoice-to').value = '';
      renderInvoices();
    });

    document.getElementById('client-search').addEventListener('input', function (e) { clientFilter = e.target.value; renderClients(); });
    document.getElementById('product-search').addEventListener('input', function (e) { productFilter = e.target.value; renderCatalog(); });
    document.getElementById('payment-search').addEventListener('input', function (e) { paymentFilters.search = e.target.value; renderPayments(); });
    document.getElementById('payment-from').addEventListener('change', function (e) { paymentFilters.from = e.target.value; renderPayments(); });
    document.getElementById('payment-to').addEventListener('change', function (e) { paymentFilters.to = e.target.value; renderPayments(); });

    var exportBtn = document.getElementById('export-invoices-btn');
    var exportMenu = document.getElementById('export-invoices-menu');
    exportBtn.addEventListener('click', function (e) { e.stopPropagation(); exportMenu.classList.toggle('open'); });
    document.addEventListener('click', function () { exportMenu.classList.remove('open'); });
    exportMenu.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-format]');
      if (btn) { exportInvoices(btn.dataset.format); exportMenu.classList.remove('open'); }
    });

    document.getElementById('settings-company-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(this);
      state.settings.companyName = fd.get('companyName').trim();
      state.settings.ein = fd.get('ein').trim();
      var file = fd.get('logo');
      var finish = function () { saveState(); applyBrand(); renderSettings(); toast('Compañía guardada.'); };
      if (file && file.size) {
        readImageAsResizedDataURL(file, 240).then(function (dataUrl) { state.settings.logo = dataUrl; finish(); });
      } else finish();
    });
    document.getElementById('logo-remove-btn').addEventListener('click', function () {
      state.settings.logo = null;
      saveState(); applyBrand(); renderSettings();
    });

    document.getElementById('settings-invoicing-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(this);
      state.settings.taxRate = Number(fd.get('taxRate')) || 0;
      state.settings.dueDays = Number(fd.get('dueDays')) || 0;
      state.settings.invoicePrefix = fd.get('invoicePrefix').trim() || 'INV-';
      state.settings.nextInvoiceNumber = Math.max(1, Number(fd.get('nextInvoiceNumber')) || 1);
      saveState();
      renderSettings();
      toast('Facturación guardada.');
    });

    document.getElementById('settings-backup-form').addEventListener('submit', function (e) {
      e.preventDefault();
      state.settings.backupReminderDays = Math.max(1, Number(new FormData(this).get('backupReminderDays')) || 14);
      saveState();
      updateBackupBanner();
      toast('Guardado.');
    });

    document.getElementById('export-backup-btn').addEventListener('click', exportBackup);
    document.getElementById('import-backup-input').addEventListener('change', function (e) {
      if (e.target.files[0]) importBackup(e.target.files[0]);
      e.target.value = '';
    });
    document.getElementById('backup-banner-btn').addEventListener('click', exportBackup);
    document.getElementById('backup-banner-dismiss').addEventListener('click', function () {
      state.bannerDismissedAt = Date.now();
      saveState();
      updateBackupBanner();
    });

    document.getElementById('reset-data-btn').addEventListener('click', function () {
      if (!confirm('Esto borra TODOS los datos de este navegador. ¿Seguro que quieres continuar?')) return;
      if (!confirm('Última confirmación: esta acción no se puede deshacer. ¿Borrar todo?')) return;
      state = defaultState();
      saveState();
      applyBrand();
      renderView(currentViewFromHash());
      updateBackupBanner();
      openOnboarding();
    });
  }

  // ---------- init ----------

  function init() {
    applyBrand();
    wireEvents();
    setView(currentViewFromHash());
    updateBackupBanner();
    if (needsOnboarding()) openOnboarding();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
