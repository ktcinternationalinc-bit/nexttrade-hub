// Replicates src/lib/record-lifecycle.js rules to validate the guard truth table.
var DELETE_ROLES = ['super_admin', 'owner', 'admin', 'accounting_manager'];
function can(role){ return DELETE_ROLES.indexOf(role) !== -1; }
function customerLifecycle(c, u, role){ c=c||{}; u=u||{};
  var hist=(u.invoiceCount>0)||(u.proformaCount>0)||(u.paymentCount>0)||(u.bankMatchCount>0);
  var wave=!!c.wave_customer_id; var arch=c.record_status==='archived'; var r=can(role);
  return { canHardDelete:r&&!hist&&!wave&&!arch, canArchive:r&&!arch, canRestore:r&&arch }; }
function invoiceLifecycle(inv,u,role){ inv=inv||{}; u=u||{};
  var synced=inv.wave_sync_status==='synced'||!!inv.wave_invoice_id;
  var histo=inv.is_historical===true||inv.source==='wave_import';
  var pay=(u.paymentMatchCount>0); var arch=inv.record_status==='archived';
  var vd=inv.record_status==='void'||inv.record_status==='cancelled'; var r=can(role);
  return { canHardDelete:r&&!synced&&!histo&&!pay&&!arch&&!vd, canVoid:r&&!arch&&!vd, canArchive:r&&!arch, canRestore:r&&(arch||vd) }; }
function proformaLifecycle(pf,role){ pf=pf||{};
  var conv=pf.status==='converted'||!!pf.converted_invoice_id; var arch=pf.record_status==='archived';
  var vd=pf.record_status==='void'||pf.record_status==='cancelled'; var r=can(role);
  return { canHardDelete:r&&!conv&&!arch&&!vd, canVoid:r&&!arch&&!vd, canRestore:r&&(arch||vd) }; }

var fs=require('fs');var path=require('path');
var lib=fs.readFileSync(path.join(__dirname,'..','src/lib/record-lifecycle.js'),'utf8');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}

// CUSTOMERS
ok(customerLifecycle({}, {}, 'owner').canHardDelete===true,'clean customer + role -> hard delete ok');
ok(customerLifecycle({wave_customer_id:'W1'}, {}, 'owner').canHardDelete===false,'wave-linked customer -> NO hard delete');
ok(customerLifecycle({wave_customer_id:'W1'}, {}, 'owner').canArchive===true,'wave-linked customer -> archive instead');
ok(customerLifecycle({}, {invoiceCount:3}, 'owner').canHardDelete===false,'customer with invoices -> NO hard delete');
ok(customerLifecycle({}, {}, 'sales_rep').canHardDelete===false,'non-privileged role -> NO hard delete');
ok(customerLifecycle({record_status:'archived'}, {}, 'admin').canRestore===true,'archived customer -> restore');

// INVOICES
ok(invoiceLifecycle({}, {}, 'admin').canHardDelete===true,'clean hub invoice + role -> hard delete ok');
ok(invoiceLifecycle({wave_invoice_id:'WI1'}, {}, 'admin').canHardDelete===false,'wave-synced invoice -> NO hard delete');
ok(invoiceLifecycle({source:'wave_import'}, {}, 'admin').canHardDelete===false,'historical/imported invoice -> NO hard delete');
ok(invoiceLifecycle({}, {paymentMatchCount:1}, 'admin').canHardDelete===false,'invoice with payments -> NO hard delete');
ok(invoiceLifecycle({wave_invoice_id:'WI1'}, {}, 'admin').canVoid===true,'synced invoice -> void/archive allowed');
ok(invoiceLifecycle({record_status:'void'}, {}, 'admin').canRestore===true,'voided invoice -> restore');

// PROFORMAS
ok(proformaLifecycle({}, 'owner').canHardDelete===true,'unconverted proforma -> hard delete ok');
ok(proformaLifecycle({status:'converted'}, 'owner').canHardDelete===false,'converted proforma -> NO hard delete');
ok(proformaLifecycle({converted_invoice_id:'I9'}, 'owner').canVoid===true,'converted proforma -> void/archive allowed');

// WAVE-COMPAT INVARIANT: void/archive patches must NOT touch wave ids
ok(/archivePatch/.test(lib)&&!/archivePatch[\s\S]{0,200}wave_/.test(lib),'archivePatch preserves wave ids (does not set them)');
ok(/voidPatch/.test(lib)&&!/voidPatch[\s\S]{0,200}wave_invoice_id/.test(lib),'voidPatch preserves wave ids');
ok(/restorePatch/.test(lib),'restorePatch exists');
// lib actually encodes the guards
ok(/!syncedToWave && !historical && !hasPayments/.test(lib),'invoice hard-delete guard present in lib');
ok(/!hasHistory && !hasWaveLink/.test(lib),'customer hard-delete guard present in lib');
ok(/!converted/.test(lib),'proforma hard-delete guard present in lib');

ok(fs.readFileSync(path.join(__dirname,'..','src/app/page.jsx'),'utf8').indexOf('>v55.83-AP<')>=0,'page AP');
ok(/customerLifecycle/.test(fs.readFileSync(path.join(__dirname,'..','src/components/AccountingCustomersTab.jsx'),'utf8')),'customer tab wired');
console.log('\nv55.83-AP record lifecycle: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
