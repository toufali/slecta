import { movieCard } from '../../../client/src/scripts/components/movieCard.js'

const sortingFields = data => data.allSorting.reduce((acc, cur) => {
  acc += `
  <label class='pill'>
    <input type='radio' name='sort' value='${cur.value}' ${data.sortBy?.includes(cur.value) ? 'checked' : ''}>
    <span>${cur.name}</span>
  </label>
  `
  return acc
}, ``)

const genreFields = data => {
  let html = ''

  // data.withGenres can be a string '27' or array ['27', '878']. The includes() function should work on both.
  for (const [id, name] of data.allGenres) html += `
  <label class='pill'>
    <input type='checkbox' name='wg' value='${id}' ${data.withGenres?.includes(id.toString()) ? 'checked' : ''}>
    <span>${name}</span>
  </label>
  `
  return html
}

const ratingFields = data => data.allRatings.reduce((acc, cur) => {
  // data.withRatings can be a string 'R' or array ['PG-13', 'R']. The includes() function should work on both.
  acc += `
  <label class='pill' title='${cur.meaning}'>
    <input type='checkbox' name='wr' value='${cur.certification}' ${data.withRatings?.includes(cur.certification) ? 'checked' : ''}>
    <span>${cur.certification}</span>
  </label>
  `
  return acc
}, ``)

export const movieList = data => `
<link rel='stylesheet' href='/styles/partials/movieList.css' type='text/css'>

<p class='list-description'>New movies sorted by <output>${data.allSorting.find(opt => opt.value === data.sortBy).name}</output></p>

<form class='movies-filter' action='/api/v1/movies' hidden>
  <fieldset>
    <h3>Sort by:</h3>
    ${sortingFields(data)}
  </fieldset>
  <fieldset>
    <h3>Include genres:</h3>
    ${genreFields(data)}
  </fieldset>
  <fieldset>
    <h3>Include ratings:</h3>
    ${ratingFields(data)}
  </fieldset>
  <fieldset>
    <h3>Availability:</h3>
    <label class='pill'>
      <input type='checkbox' name='streaming' ${data.streamingNow ? 'checked' : ''}>
      <span>Streaming now</span>
    </label>
  </fieldset>
  <button class='primary' type='submit'>APPLY</button>
</form>

<ul class='movies-list'>
  ${data.movies.map(movie => `<li>${movieCard(movie)}</li>`).join('')}
</ul>

<button class='filter-toggle primary' type='button'>FILTER</button>
`