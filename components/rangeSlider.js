const html = data => `
<style>
  :host{
    --x-offset: 13px;
    contain: layout style;
    display: inline-flex;
    align-items: center;
    height: var(--range-h);
  }

  :host([hidden]) {
    display: none 
  }

  form {
    position: relative;
  }

  input {
    appearance: none;
    position: relative;
    display: block;
    width: calc(100% - var(--x-offset));
    background: var(--blue-50);
    box-shadow: var(--x-offset) 0 0 var(--blue-50); /* extend track underneath both inputs */
    height: 2px;
    padding: 0;
    margin: 0;
    pointer-events: none;
  }

  input[name="input2"] {
    position: absolute;
    top: 50%;
    left: 0;
    transform: translate(var(--x-offset), -50%);
    background: none;
    box-shadow: none;
  }

  input::-webkit-slider-thumb {
    appearance: none;
    box-sizing: border-box;
    border: 1px solid var(--blue-50);
    height: var(--range-h);
    width: 12px;
    border-radius: 12px;
    background: var(--green-50);
    cursor: pointer;
    box-shadow: 1px 1px 2px #0008;
    pointer-events: auto;
  }
  
  input::-moz-range-thumb {
    box-sizing: border-box;
    border: 1px solid var(--blue-50);
    height: var(--range-h);
    width: 12px;
    border-radius: 12px;
    background: var(--green-50);
    cursor: pointer;
    box-shadow: 1px 1px 2px #0008;
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
