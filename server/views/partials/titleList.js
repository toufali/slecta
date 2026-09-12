import { movieCard } from '../../../client/src/scripts/components/movieCard.js'
import { monthsText } from '../../../client/src/scripts/utils/months.js'

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

// Three genres stand for the rest: the panel holds the full list
function genreNames(data, disjunctionFmt) {
  const names = data.withGenres.map(genre => data.allGenres.get(parseInt(genre)))

  return names.length > 3 ? `${names.slice(0, 3).join(', ')}…` : disjunctionFmt.format(names)
}

function listDescription(data, dated) {
  // TODO: this is almost the same function as `client/scripts/titleList.js` – any way to DRY?
  const conjunctionFmt = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" })
  const disjunctionFmt = new Intl.ListFormat("en-US", { style: "short", type: "disjunction" })

  let sort, genres, ratings, streaming, language

  sort = `<label>sorted by <output>${data.allSorting.find(opt => opt.value === data.sortBy).name}</output></label>`
  if (data.streamingNow) streaming = `<output>streaming now</output>`
  if (data.inEnglish) language = `<output>in English</output>`
  if (data.withGenres) genres = `<label>with genre <output>${genreNames(data, disjunctionFmt)}</output></label>`
  if (data.withRatings) ratings = `<label>rated <output>${disjunctionFmt.format(data.withRatings)}</output></label>`

  const lookback = `<label>${dated} in the last <output>${monthsText(data.lookback)}</output></label>`

  return conjunctionFmt.format([streaming, language, sort, genres, ratings, lookback].filter(item => item))
}

const COPY = {
  movies: { noun: 'Movies', dated: 'released', datedHeading: 'Released' },
  shows: { noun: 'TV Shows', dated: 'first aired', datedHeading: 'First aired' }
}

export const titleList = data => {
  const segment = data.movies ? 'movies' : 'shows'
  const { noun, dated, datedHeading } = COPY[segment]

  return `
<link rel='stylesheet' href='/styles/partials/titleList.css' type='text/css'>

<h1 class='list-description'>${noun} ${listDescription(data, dated)}</h1>

<ul class='movie-list'>
  ${data[segment].map(title => `<li>${movieCard(title)}</li>`).join('')}
</ul>

<a class='button pill more' rel='next' ${data.nextPage ? `href='${data.nextPage}'` : 'hidden'}>Show more</a>

<button class='filter-toggle primary' type='button'>Filter</button>

<div class='filter-panel hidden'>
  <form name='movie-filter' action='/api/v1/${segment}'>
    <fieldset>
      <h3>Sort by:</h3>
      ${sortingFields(data)}
    </fieldset>
    <fieldset>
      <h3>Include genres:</h3>
      ${genreFields(data)}
    </fieldset>
    ${!data.allRatings ? '' : `<fieldset>
      <h3>Include ratings:</h3>
      ${ratingFields(data)}
    </fieldset>`}
    <fieldset>
      <h3 id='lookback-label'>${datedHeading} in the last:</h3>
      <div class='lookback'>
        <input type='range' name='months' min='1' max='${data.lookbackMax}' value='${data.lookback}' aria-labelledby='lookback-label' aria-valuetext='${monthsText(data.lookback)}'>
        <!-- Hidden because the value text now reads the same words: announced twice, once per handle move -->
        <output aria-hidden='true'>${monthsText(data.lookback)}</output>
      </div>
    </fieldset>
    <fieldset>
      <h3>Language:</h3>
      <label class='pill'>
        <input type='checkbox' name='english' ${data.inEnglish ? 'checked' : ''}>
        <span>English</span>
      </label>
    </fieldset>
    <fieldset>
      <h3>Availability:</h3>
      <label class='pill'>
        <input type='checkbox' name='streaming' ${data.streamingNow ? 'checked' : ''}>
        <span>Streaming now</span>
      </label>
    </fieldset>
    <fieldset>
      <button class='primary' type='submit'>APPLY</button>
    </fieldset>
  </form>
</div>
`
}
