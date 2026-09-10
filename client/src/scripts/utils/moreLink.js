// One source for the control the server renders and `resetMore` rebuilds, so they cannot drift
export const moreLink = href => !href ? '' : `<a class='button secondary more' rel='next' href='${href}'>More</a>`
