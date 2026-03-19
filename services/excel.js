// ICC Dispatch — Excel Export Service
const XLSX = require('xlsx');

function generateDispatchExcel(dispatches, filename) {
  const wb = XLSX.utils.book_new();
  wb.Props = { Title: 'ICC Dispatch Report', Author: 'ICC Dispatch System' };

  // Main dispatch sheet
  const headers = [
    'Invoice #','Date','Order #','Acc No','Customer','Email','Phone','Address','City',
    'Invoiced By','Picker','Packer','Checker','Weight (kg)','Boxes','Bales','Grey Bags',
    'Total Packages','Delivery Method','Transport Co','Truck','Driver','Driver Phone',
    'License Plate','Tracking #','Value (Excl)','Status','Captured By','Captured At','Dispatched At'
  ];

  const rows = dispatches.map(d => [
    d.inv_number, d.inv_date ? new Date(d.inv_date).toLocaleDateString('en-ZA') : '',
    d.order_num||'', d.acc_no||'', d.acc_name||'', d.email||'', d.phone||'',
    d.address||'', d.city||'', d.invoiced_by||'', d.picker||'', d.packer||'', d.checker||'',
    d.weight||0, d.boxes||0, d.bales||0, d.grey_bags||0, d.total_packages||'',
    d.delivery_method||'', d.transport_company||'', d.truck_name||'',
    [(d.driver_first_name||''), (d.driver_surname||'')].filter(Boolean).join(' '),
    d.driver_phone||'', d.license_plate||'', d.tracking_number||'',
    parseFloat(d.inv_tot_excl)||0, d.dispatch_status||'pending',
    d.captured_by||'', d.captured_at ? new Date(d.captured_at).toLocaleString('en-ZA') : '',
    d.dispatched_at ? new Date(d.dispatched_at).toLocaleString('en-ZA') : ''
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Column widths
  ws['!cols'] = headers.map((h,i) => ({ wch: Math.max(h.length, 12) }));

  // Style header row bold (basic)
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (!ws[addr]) continue;
    ws[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: '0D2B5E' } }, font: { color: { rgb: 'FFFFFF' }, bold: true } };
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Dispatch Records');

  // Summary sheet
  const total = dispatches.length;
  const delivered = dispatches.filter(d=>d.dispatch_status==='delivered').length;
  const pending = dispatches.filter(d=>!d.transport_company).length;
  const totalVal = dispatches.reduce((s,d)=>s+parseFloat(d.inv_tot_excl||0),0);

  const summaryData = [
    ['ICC Dispatch Summary Report'],
    ['Generated:', new Date().toLocaleString('en-ZA')],
    [''],
    ['Total Invoices', total],
    ['Pending Capture', pending],
    ['Delivered', delivered],
    ['Total Value (Excl)', `R ${totalVal.toLocaleString('en-ZA',{minimumFractionDigits:2})}`],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(summaryData);
  ws2['!cols'] = [{wch:25},{wch:20}];
  XLSX.utils.book_append_sheet(wb, ws2, 'Summary');

  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
}

module.exports = { generateDispatchExcel };
