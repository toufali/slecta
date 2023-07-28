const html = data => `
<style>
  :host{
    display: inline-block;
    contain: content;
  }

  :host([hidden]) {
    display: none 
  }

  form {
    position: relative;
    background: linear-gradient(#888, #888) no-repeat 50% / 100% 4px;
    border-radius: 50%;
  }

  input {
    position: relative;
    display: block;
    width: calc(100% - 16px);
    padding: 0;
    margin: 0;
    background: none;
    pointer-events: none;
    -webkit-appearance: none;
    -moz-appearance: none;
  }

  input[name="input2"] {
    position: absolute;
    top: 0;
    left: 0;
    transform: translateX(16px);
  }

  ::-webkit-slider-thumb{
    pointer-events: auto;
  }

  ::-moz-range-thumb{
    pointer-events: auto;
  }

</style>
<form>
  <input type="range" name="input1" min="${data.min}" max="${data.max}" value="${data.minDefault}" step="1">
  <input type="range" name="input2" min="${data.min}" max="${data.max}" value="${data.maxDefault}" step="1">
</form>
`

customElements.define('range-slider', class extends HTMLElement {
  static formAssociated = true
  #min = this.getAttribute('min')
  #max = this.getAttribute('max')
  #value = this.getAttribute('value').split(',')
  #internals

  constructor() {
    super()

    this.#internals = this.attachInternals()
    this.#internals.setFormValue(this.#value)

    this.attachShadow({ mode: 'open' })
    this.shadowRoot.innerHTML = html({
      min: this.#min,
      max: this.#max,
      minDefault: this.#value[0],
      maxDefault: this.#value[1]
    })
    this.shadowRoot.addEventListener('input', e => this.handleInput(e))
    this.shadowRoot.addEventListener('change', e => this.handleChange(e))

    this.input1 = this.shadowRoot.querySelector('[name="input1"]')
    this.input2 = this.shadowRoot.querySelector('[name="input2"]')
  }

  get value() {
    return this.#value // returns Array e.g. [2002,2003] in contrast to the "value" HTML attribute which returns String e.g. "2002,2003" 
  }

  get name() {
    return this.getAttribute('name')
  }

  handleInput(e) {
    if (e.target === this.input1) {
      this.input2.value = Math.max(this.input1.value, this.input2.value)
    } else {
      this.input1.value = Math.min(this.input1.value, this.input2.value)
    }
    this.#value = [this.input1.value, this.input2.value]
    this.dispatchEvent(new Event('input', {
      bubbles: true,
      composed: true
    }))
  }

  handleChange(e) {
    this.#internals.setFormValue(this.#value)
    this.setAttribute('value', this.#value)
    this.dispatchEvent(new Event('change', {
      bubbles: true,
      composed: true
    }))
  }
})
