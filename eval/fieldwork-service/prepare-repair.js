// Create a separate evaluation app while leaving the original Fieldwork demo intact.
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, STATE } = require('../../dqa/core/util')

const target = path.join(STATE, 'fieldwork-repair', process.argv[2] === '--reference' ? 'reference' : 'frontend')
const clean = process.argv[2] === '--reference'
if (fs.existsSync(target)) throw Error('Choose a fresh state directory or use the existing evaluation app')
fs.mkdirSync(path.dirname(target), { recursive: true })
fs.cpSync(path.join(ROOT, 'eval/fieldwork-service/reference'), target, { recursive: true })
const app = path.join(target, 'app.js')
const css = path.join(target, 'style.css')
let source = fs.readFileSync(app, 'utf8')
function replaceOnce (old, value) {
  if (source.split(old).length !== 2) throw Error('Unexpected Fieldwork reference source')
  source = source.replace(old, value)
}
replaceOnce('const product=products[item]||products.clay;', `const product=products[item]||products.clay;
const productPriceElement = document.querySelector('.booking-action p');
async function refreshVisitPrice() {
  const response = await fetch('/api/visit-price?item=' + encodeURIComponent(item));
  if (!response.ok) return;
  const quote = await response.json();
  if (typeof quote.price !== 'number') return;
  productPriceElement.textContent = money(${clean ? 'quote.price' : 'product.price'}) + ' / guest';
}
if (screen === 'product') refreshVisitPrice().catch(() => {});`)
if (!clean) {
  replaceOnce("filter=a.slice(7);", "filter='All';")
  const style = fs.readFileSync(css, 'utf8').replace('.fw-63{font-size:26px;', '.fw-63{font-size:38px;')
  fs.writeFileSync(css, style)
}
fs.writeFileSync(app, source)
console.log(target)
