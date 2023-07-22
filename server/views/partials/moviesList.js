const genreChecklist = data => data.genres.reduce((acc, cur) => {
  // selectedGenres can be a string '27' or array ['27', '878']. The includes() function should work on both.
  acc += `
  <label>
    <input type='checkbox' name='genres' value='${cur.id}' ${data.selectedGenres.includes(cur.id.toString()) ? 'checked' : ''}>
    <span>${cur.name}</span>
  </label>`
  return acc
}, ``);

export const moviesList = data => `
<form action='/api/v1/movies'>
  <p>Choose genres:</p>
  ${genreChecklist(data)}
  <button type='submit'>SUBMIT</button>
</form>
<ul class='movies-list'></ul>
`