const demoScope=location.pathname.match(/^\/demo\/fieldwork\/(before|after\/[^/]+)\//)?.[1];
const KEY=demoScope?'fieldwork-state:'+demoScope:'fieldwork-state';
const DEFAULT={guests:2,date:'2026-10-24',slot:'14:00',cart:false,discount:0,booking:null};
const demoSeed={"guests":2,"date":"2026-10-24","slot":"14:00","cart":true,"discount":0,"item":"clay","booking":{"id":"FW-1042","name":"Jamie Park","email":"jamie@example.test","date":"2026-10-24","guests":2,"total":116000,"cancelled":false}};
let state={...DEFAULT,...(demoScope?demoSeed:{}),...JSON.parse(localStorage.getItem(KEY)||'{}')};
const screen=document.querySelector('main').dataset.screen;
const products={clay:{title:'Clay & conversation: hand-built ceramics with local makers',price:58000},coffee:{title:'A slow morning: coffee tasting in a working roastery',price:42000},garden:{title:'Botanical walks and seasonal flower arranging',price:64000},print:{title:'Make your own screen-printed art edition',price:52000}};
const item=new URLSearchParams(location.search).get('item')||state.item||'clay';
const product=products[item]||products.clay;
function save(){localStorage.setItem(KEY,JSON.stringify(state))}
function money(v){return 'KRW '+v.toLocaleString('en-US')}
function message(s,error=false){const e=document.getElementById('messages');e.className=error?'error':'notice';e.textContent=s}
function route(path){location.href=path}
function render(){
 document.querySelectorAll('.quantity-value').forEach(e=>e.textContent=state.guests);
 document.querySelectorAll('[data-action="quantity-down"]').forEach(e=>e.disabled=state.guests<=1);
 document.querySelectorAll('[data-action="quantity-up"]').forEach(e=>e.disabled=state.guests>=6);
 document.querySelectorAll('.subtotal').forEach(e=>e.textContent=money(state.guests*product.price));
 document.querySelectorAll('.total').forEach(e=>e.textContent=money(state.guests*product.price-state.discount));
 document.querySelectorAll('.price-summary .row:first-of-type p:first-child').forEach(e=>e.textContent=state.guests+' guests × '+money(product.price));
 document.querySelectorAll('.selection p:first-child').forEach(e=>e.textContent=new Date(state.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long'})+', '+new Date(state.date+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'long'}));
 document.querySelectorAll('.selection p:last-child').forEach(e=>e.textContent=state.slot+'–'+(Number(state.slot.slice(0,2))+2)+':00 · English · '+state.guests+' guests');
 if(screen==='product'){
  document.querySelector('.product-title').textContent=product.title;
  document.querySelector('.art').src='assets/'+item+'.svg';
  document.getElementById('visit-date').value=state.date;
  document.querySelector('.booking-action p').textContent=money(product.price)+' / guest';
  document.querySelector('.availability').textContent=state.slot==='14:00'?'2 places available for this session.':'6 places available for this session.';
 }
 if(screen==='cart'&&!state.cart){document.querySelector('.cart-item').hidden=true;document.querySelector('.price-summary').hidden=true;document.querySelector('[data-action="checkout.html"]').disabled=true;message('Your bag is empty. Explore experiences to find your next visit.')}
 if(screen==='bookings'){
  const b=state.booking;
  if(!b){document.querySelector('.booking-status').textContent='No upcoming visits';document.querySelector('[data-action="cancel-booking"]').disabled=true;document.querySelector('[data-action="toggle-details"]').disabled=true;document.querySelector('.booking-reference').textContent='Explore experiences to make your first booking.'}
  else {document.querySelector('.booking-status').textContent=b.cancelled?'Booking cancelled':'Booking confirmed';document.querySelector('.booking-reference').textContent='Booking '+b.id;document.querySelector('[data-action="cancel-booking"]').disabled=!!b.cancelled}
 }
}
let filter='All';
function filterProducts(){const term=document.getElementById('search').value.toLowerCase();let n=0;document.querySelectorAll('.product-card').forEach(e=>{const yes=(filter==='All'||e.dataset.category===filter)&&e.textContent.toLowerCase().includes(term);e.hidden=!yes;if(yes)n++});document.querySelector('.result-count').textContent=n+' experiences';if(!n)message('No experiences match. Try another search or choose All.');else document.getElementById('messages').textContent=''}
document.getElementById('search')?.addEventListener('input',filterProducts);
document.getElementById('visit-date')?.addEventListener('change',e=>{state.date=e.target.value;save()});
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-action]');if(!b||b.disabled)return;const a=b.dataset.action;
 if(a.startsWith('filter:')){filter=a.slice(7);document.querySelectorAll('.filters button').forEach(x=>x.classList.toggle('selected',x===b));filterProducts();return}
 if(a.startsWith('slot:')){state.slot=a.slice(5);save();document.querySelectorAll('[data-action^="slot:"]').forEach(x=>x.classList.toggle('selected',x===b));render();return}
 if(a==='quantity-up'||a==='quantity-down'){state.guests=Math.max(1,Math.min(6,state.guests+(a==='quantity-up'?1:-1)));state.discount=0;save();render();return}
 if(a==='add-to-cart'){
  if(!state.date){message('Choose a date before adding your visit.',true);return}
  if(state.slot==='14:00'&&state.guests>2){message('Only 2 places remain at 14:00. Choose fewer guests or the 17:00 session.',true);return}
  state.cart=true;state.item=item;save();route('cart.html');return
 }
 if(a==='remove-cart'){state.cart=false;state.discount=0;save();render();return}
 if(a==='apply-promo'){const code=document.getElementById('promo').value.trim().toUpperCase();state.discount=code==='WEEKEND10'?Math.round(state.guests*product.price*.1):0;save();render();message(state.discount?'10% discount applied.':'This code is not valid. Try WEEKEND10.',!state.discount);return}
 if(a==='confirm-booking'){
  document.querySelectorAll('.field-error').forEach(e=>e.remove());let invalid=[];
  const name=document.getElementById('guest-name'),email=document.getElementById('guest-email'),phone=document.getElementById('guest-phone');
  if(name.value.trim().length<2)invalid.push([name,'Enter your full name.']);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value))invalid.push([email,'Enter a valid email address.']);
  if(phone.value.replace(/\D/g,'').length<8)invalid.push([phone,'Enter a phone number your host can use.']);
  if(!document.getElementById('terms').checked)invalid.push([document.getElementById('terms'),'Agree to the cancellation policy.']);
  for(const [el,txt] of invalid){const p=document.createElement('p');p.className='error field-error';p.textContent=txt;el.parentElement.after(p);el.setAttribute('aria-invalid','true')}
  if(invalid.length){invalid[0][0].focus();message('Check the highlighted details before confirming.',true);return}
  if(!state.cart){message('Your bag is empty. Add a visit before confirming.',true);return}
  b.disabled=true;b.textContent='Confirming…';
  state.booking={id:'FW-1042',name:name.value.trim(),email:email.value,date:state.date,guests:state.guests,total:state.guests*product.price-state.discount,cancelled:false};state.cart=false;save();route('bookings.html');return
 }
 if(a==='toggle-details'){let d=document.getElementById('booking-details');if(d){d.remove();return}d=document.createElement('div');d.id='booking-details';d.className='notice';d.textContent=state.booking.name+' · '+state.booking.email+' · Paid '+money(state.booking.total);b.after(d);return}
 if(a==='cancel-booking'){
  const dialog=document.createElement('dialog');dialog.innerHTML='<form method="dialog"><h2>Cancel this visit?</h2><p>Your booking will be marked as cancelled on this device.</p><button value="keep" class="outlined">Keep booking</button><button value="cancel" class="cta danger">Yes, cancel visit</button></form>';document.body.append(dialog);dialog.addEventListener('close',()=>{if(dialog.returnValue==='cancel'){state.booking.cancelled=true;save();render();message('Your visit has been cancelled.')}dialog.remove()});dialog.showModal();return
 }
 if(/\.html(?:\?|$)/.test(a))route(a);
});
render();
