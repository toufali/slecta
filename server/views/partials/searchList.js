export const searchForm = `
<search>
  <h1>Search movies and TV shows by title:</h1>
  <input name="title" type="search" placeholder="Enter title here" required minlength="2" autocomplete="off" autofocus>
</search>
<ol class='result-list'></ol>
<p class='no-results'>No results.</p><!-- TODO: show suggestions/promotions/trending etc -->
`

export const searchList = data => `
${searchForm}
`

searchList.styles = '/styles/partials/searchList.css'
