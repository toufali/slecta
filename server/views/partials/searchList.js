export const searchList = data => `

<search>
  <h1>Search movies and TV shows by title:</h1>
  <input name="title" type="search" placeholder="Enter title here" autocomplete="off" autofocus>
</search>
<ol class='result-list'></ol>
<p class='no-results'>No results.</p><!-- TODO: show suggestions/promotions/trending etc -->
`

searchList.styles = '/styles/partials/searchList.css'
