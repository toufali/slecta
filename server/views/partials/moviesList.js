const genreChecklist = data => data.allGenres.reduce((acc, cur) => {
  // data.genres can be a string '27' or array ['27', '878']. The includes() function should work on both.
  acc += `
  <label>
    <input type='checkbox' name='genres' value='${cur.id}' ${data.genres.includes(cur.id.toString()) ? 'checked' : ''}>
    <span>${cur.name}</span>
  </label>
  `
  return acc
}, ``);

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
    <p>Choose genres:</p>
    ${genreChecklist(data)}
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