export const reviewQuote = data => `
  <blockquote cite="${data.sourceLink}">
    <p>${data.quote}</p>
    <cite><a href="${data.sourceLink}" target="_blank">${data.sourceName}</a></cite>
  </blockquote>
`