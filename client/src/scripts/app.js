function supportsDeclarativeShadowDOM() {
  const supported = HTMLTemplateElement.prototype.hasOwnProperty('shadowRootMode');
  console.info('Declarative Shadow DOM support:', supported)
  return supported
}

if (!supportsDeclarativeShadowDOM()) {
  console.info('Applying Declarative Shadow DOM polyfill.');
  // https://developer.chrome.com/en/articles/declarative-shadow-dom/#polyfill
  (function attachShadowRoots(root) {
    root.querySelectorAll("template[shadowrootmode]").forEach(template => {
      const mode = template.getAttribute("shadowrootmode");
      const shadowRoot = template.parentNode.attachShadow({ mode });
      shadowRoot.appendChild(template.content);
      template.remove();
      attachShadowRoots(shadowRoot);
    });
  })(document);
}
