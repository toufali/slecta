export const searchList = data => `
<link rel='stylesheet' href='/styles/partials/searchList.css' type='text/css'>

<h1>Search movies and TV shows by title</h1>

<search>
  <input name="title" type="search" placeholder="Enter movie or show title" autocomplete="off" autofocus>
  <ol class='result-list'></ol>
  <p class='no-results'>No results.</p><!-- TODO: show suggestions/promotions/trending etc -->
</search>

`