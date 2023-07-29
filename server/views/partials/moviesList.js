const withGenres = data => {
  let html = ''

  // data.withGenres can be a string '27' or array ['27', '878']. The includes() function should work on both.
  for (const [id, name] of data.allGenres) html += `
  <label>
    <input type='checkbox' name='wg' value='${id}' ${data.withGenres.includes(id.toString()) ? 'checked' : ''}>
    <span>${name}</span>
  </label>
  `
  return html
}

const withoutGenres = data => {
  let html = ''

  // data.withoutGenres can be a string '27' or array ['27', '878']. The includes() function should work on both.
  for (const [id, name] of data.allGenres) html += `
  <label>
    <input type='checkbox' name='wog' value='${id}' ${data.withoutGenres.includes(id.toString()) ? 'checked' : ''}>
    <span>${name}</span>
  </label>
  `
  return html
}

const sortOptions = ['popularity.desc', 'popularity.asc', 'primary_release_date.desc', 'primary_release_date.asc', 'vote_average.desc', 'vote_average.asc']
const sortRadiolist = data => sortOptions.reduce((acc, cur) => {
  acc += `
  <label>
    <input type='radio' name='sort' value='${cur}' ${data.sort.includes(cur) ? 'checked' : ''}>
    <span>${cur}</span>
  </label>
  `
  return acc
}, ``)

export const moviesList = data => `
<form action='/api/v1/movies'>
  <fieldset>
    <p>Include genres:</p>
    ${withGenres(data)}
  </fieldset>
  <fieldset>
    <p>Exclude genres:</p>
    ${withoutGenres(data)}
  </fieldset>
  <fieldset>
    <p>Sort by:</p>
    ${sortRadiolist(data)}
  </fieldset>
  <fieldset>
    <p>Minimum review score:</p>
    <label>
      <input type="range" name="score" min="0" max="100" value="${data.reviewScore}" step="1">
      <output>${data.reviewScore}</output>
    </label>
    <p>Minimum review count:</p>
    <label>
      <input type="range" name="count" min="10" max="1000" value="${data.reviewCount}" step="10">
      <output>${data.reviewCount}</output>
    </label>
    <p>Release date:</p>
    <label>
      <range-slider name="years" min='1900' max='${data.currentYear}' value='${data.years}'></range-slider>
      <output>${data.years.split(',').join(' - ')}</output>
    </label>
  </fieldset>
</form>
<ul class='movies-list'></ul>
`