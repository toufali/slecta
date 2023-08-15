const withGenres = data => {
  let html = ''

  // data.withGenres can be a string '27' or array ['27', '878']. The includes() function should work on both.
  for (const [id, name] of data.allGenres) html += `
  <label class='pill'>
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
  <label class='pill'>
    <input type='checkbox' name='wog' value='${id}' ${data.withoutGenres.includes(id.toString()) ? 'checked' : ''}>
    <span>${name}</span>
  </label>
  `
  return html
}

const sortOptions = [['Popularity', 'popularity.desc'], ['Most Recent', 'primary_release_date.desc'], ['Score', 'vote_average.desc']]
const sortRadiolist = data => sortOptions.reduce((acc, cur) => {
  acc += `
  <label>
    <input type='radio' name='sort' value='${cur[1]}' ${data.sort.includes(cur[1]) ? 'checked' : ''}>
    <span>${cur[0]}</span>
  </label>
  `
  return acc
}, ``)

export const moviesList = data => `
<form action='/api/v1/movies' hidden>
  <fieldset>
    <h4>Include genres:</h4>
    ${withGenres(data)}
  </fieldset>
  <fieldset>
    <h4>Exclude genres:</h4>
    ${withoutGenres(data)}
  </fieldset>
  <fieldset>
    <h4>Sort by:</h4>
    ${sortRadiolist(data)}
  </fieldset>
  <fieldset>
    <h4>Minimum review score:</h4>
    <label>
      <input type="range" name="score" min="0" max="100" value="${data.reviewScore}" step="1">
      <output>${data.reviewScore}</output>
    </label>
    <h4>Minimum review count:</h4>
    <label>
      <input type="range" name="count" min="10" max="1000" value="${data.reviewCount}" step="10">
      <output>${data.reviewCount}</output>
    </label>
    <h4>Release date:</h4>
    <label>
      <range-slider name="years" min='1900' max='${data.currentYear}' value='${data.years}'></range-slider>
      <output>${data.years.split(',').join(' - ')}</output>
    </label>
  </fieldset>
  <button class='primary'>APPLY</button>
</form>
<ul class='movies-list'></ul>
<button class='form-toggle primary' type='button'>FILTER</button>
`