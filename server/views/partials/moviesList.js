const genreChecklist = data => data.genres.reduce((acc, cur) => {
  // selectedGenres can be a string '27' or array ['27', '878']. The includes() function should work on both.
  acc += `
  <label>
    <input type='checkbox' name='genres' value='${cur.id}' ${data.selectedGenres.includes(cur.id.toString()) ? 'checked' : ''}>
    <span>${cur.name}</span>
  </label>
  `
  return acc
}, ``);

const sortOptions = ['popularity.desc', 'popularity.asc', 'primary_release_date.desc', 'primary_release_date.asc', 'vote_average.desc', 'vote_average.asc']
const sortRadiolist = data => sortOptions.reduce((acc, cur) => {
  acc += `
  <label>
    <input type='radio' name='sort' value='${cur}' ${data.selectedSort.includes(cur) ? 'checked' : ''}>
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
      <input type="range" name="score" min="0" max="100" value="${data.selectedScore}" step="1">
      <output>${data.selectedScore}</output>
    </label>
  </fieldset>
</form>
<ul class='movies-list'></ul>
`