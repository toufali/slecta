import env from "../env.js"
import redis from "./redisService.js"

const { TMDB_TOKEN, TMDB_API_URL } = env
const headers = {
  accept: 'application/json',
  Authorization: `Bearer ${TMDB_TOKEN}`
}

// Bump when the cached detail shape changes, so a deploy cannot serve objects the views no
// longer understand. Scoped to detail deliberately: a global version would also discard the
// IMDb dataset and every score record, which are expensive to rebuild.
const DETAIL_CACHE_VERSION = 2

// Same idea for the list shape: an entry written before `totalPages`/`totalResults` existed would
// silently limit the nightly run to page one.
const LIST_CACHE_VERSION = 2

// Everything the two catalogues disagree about. Keys rather than values for the genre map and sort
// list, since both are built at init. `segment` covers the cache-key prefix, the list property and
// the detail path — they are already the same word.
const CATALOGUE = {
  movie: {
    segment: 'movies',
    path: 'movie',
    dateParam: 'primary_release_date',
    dateField: 'release_date',
    titleField: 'title',
    genreKey: 'movie',
    certifications: true,
    video: true,
    monetization: 'buy|free|flatrate|rent',
    append: 'videos,release_dates,watch/providers,external_ids,credits',
    detail: (json, region) => ({
      rating: json.release_dates.results.find(item => item.iso_3166_1 === region)?.release_dates.find(release => release.certification !== '')?.certification ?? '',
      cast: json.credits.cast.slice(0, 5).map(item => item.name).join(', '),
      director: json.credits.crew.filter(item => /^director$/i.test(item.job)).map(item => item.name).join(', '),
      runtime: json.runtime || null // TMDB reports 0 for an unreleased film
    })
  },
  tv: {
    segment: 'shows',
    path: 'tv',
    dateParam: 'first_air_date',
    dateField: 'first_air_date',
    titleField: 'name',
    genreKey: 'show',
    certifications: false,
    video: false,
    // TV alone counts ad-supported as available
    monetization: 'buy|free|flatrate|rent|ads',
    append: 'videos,watch/providers,external_ids,aggregate_credits,content_ratings',
    detail: (json, region) => ({
      cast: json.aggregate_credits.cast.slice(0, 5).map(item => item.name).join(', '),
      creator: json.created_by.map(item => item.name).join(', '),
      rating: json.content_ratings.results.find(item => item.iso_3166_1 === region)?.rating ?? '',
      seasons: json.number_of_seasons
    })
  }
}

class TmdbService {
  // TMDB votes a title needs to enter the catalogue, on the job and the list path alike. Below
  // this it is too thinly sourced to score; search plus a live detail lookup reaches the rest.
  minVotes = 25
  pageMax = 500 // TMDB 400s on a higher page
  language = 'en-US' // TODO: base on user/browser preference
  includeAdult = false
  includeVideo = false // "video" content is not theatrically released and may include: compilations, sport events, concerts, plays, fitness video, how-to, etc
  sortingOptions = {
    movies: [
      { name: 'Most Recent', value: 'primary_release_date.desc' },
      { name: 'Popularity', value: 'popularity.desc' }
    ],
    shows: [
      { name: 'Most Recent', value: 'first_air_date.desc' },
      { name: 'Popularity', value: 'popularity.desc' }
    ]
  }
  region = 'US'
  providerPriority = [
    8, // Netflix
    10, // Amazon Video
    337, // Disney+
    2, // Apple TV
    15, // Hulu
    1899, // Max
    7, // Vudu
    386, // Peacock
    192, // YouTube
    531, // Paramount+
    9, // Amazon Prime Video
    188, // YouTube Premium
    207, // Roku Channel    
  ]
  providerHidden = [
    3, // Google Play Movies
  ]
  imgConfig
  genres = {}
  ratings

  async init() {
    const [imgConfig, genres, ratings] = await Promise.all([this.#getImgConfig(), this.#getGenres(), this.#getRatings()])
    this.imgConfig = imgConfig
    this.genres.all = genres.all
    this.genres.movie = genres.movie
    this.genres.show = genres.show
    this.ratings = ratings
    console.info('TMDB initialized:', Boolean(this.imgConfig && this.genres && this.ratings))
    console.info('- from cache:', Boolean(this.imgConfig.cacheHit && genres.cacheHit && this.ratings.cacheHit))
  }

  async #getImgConfig() {
    const url = `${TMDB_API_URL}/configuration`

    let imgConfig = await redis.getCache(url)
    if (imgConfig) return imgConfig

    try {
      const res = await fetch(url, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const { images } = await res.json()
      imgConfig = images
      redis.setCache(url, imgConfig)
    } catch (e) {
      console.error("Error getting TMDB imgConfig:", e)
      console.info('Fallback using mock imgConfig.')
      imgConfig = {
        base_url: 'http://image.tmdb.org/t/p/',
        secure_base_url: 'https://image.tmdb.org/t/p/',
        backdrop_sizes: ['w300', 'w780', 'w1280', 'original'],
        logo_sizes: ['w45', 'w92', 'w154', 'w185', 'w300', 'w500', 'original'],
        poster_sizes: ['w92', 'w154', 'w185', 'w342', 'w500', 'w780', 'original'],
        profile_sizes: ['w45', 'w185', 'h632', 'original'],
        still_sizes: ['w92', 'w185', 'w300', 'original']
      }
    }
    return imgConfig
  }

  async #getGenres() {
    const urls = [`${TMDB_API_URL}/genre/movie/list?language=${this.language}`, `${TMDB_API_URL}/genre/tv/list?language=${this.language}`]

    let genres = await redis.getCache(`${TMDB_API_URL}/genre`)
    if (genres) return genres

    try {
      const [movieGenres, showGenres] = await Promise.allSettled(urls.map(async url => {
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        const { genres } = await res.json()
        return new Map(genres.map(genre => [genre.id, genre.name]))
      }));

      genres = {
        movie: movieGenres.value,
        show: showGenres.value,
        all: new Map([...movieGenres.value, ...showGenres.value])
      }

      redis.setCache(`${TMDB_API_URL}/genre`, genres, 60 * 60 * 24)
    } catch (e) {
      console.error("Error getting TMDB genres:", e)
    }
    return genres
  }

  async #getRatings() {
    const url = `${TMDB_API_URL}/certification/movie/list`

    let ratings = await redis.getCache(url)
    if (ratings) return ratings

    try {
      const res = await fetch(url, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const { certifications } = await res.json()
      ratings = certifications[this.region]
      ratings.sort((a, b) => a.order - b.order)

      redis.setCache(url, ratings)
    } catch (e) {
      console.error("Error getting TMDB certifications (ratings):", e)
    }
    return ratings
  }

  // Vocabularies the filter validator checks against. Sort keys and genre ids differ per media
  // type; an omitted rule leaves that param unjudged.
  filterRules(mediaType) {
    const media = CATALOGUE[mediaType] ?? CATALOGUE.movie

    return {
      pageMax: this.pageMax,
      sorts: this.sortingOptions[media.segment],
      genres: this.genres[media.genreKey],
      ratings: media.certifications ? this.ratings : undefined
    }
  }

  async getMovies(query) {
    return this.#getList('movie', query)
  }

  async getTvShows(query) {
    return this.#getList('tv', query)
  }

  // One skeleton for both catalogues: build params, prune, read cache, fetch, map, decorate. The
  // pairs this replaces had already drifted once — TV read `release_date` where TMDB sends
  // `first_air_date` — and the drift was in the mapping, not in anything the two genuinely differ on.
  async #getList(mediaType, query) {
    const media = CATALOGUE[mediaType]
    const genres = this.genres[media.genreKey]
    const sorts = this.sortingOptions[media.segment]

    // TMDB silently ignores `certification` without `certification_country`, and
    // `with_watch_monetization_types` without `watch_region`. Verified 2026-08-24.
    // Key order is the cache key: these are serialised in insertion order, so a movie-only param
    // dropping out must not reorder the rest.
    const params = {
      page: query?.page || 1,
      include_adult: this.includeAdult,
      include_video: media.video ? this.includeVideo : undefined,
      sort_by: query?.sort || sorts[0].value,
      [`${media.dateParam}.lte`]: new Date().toISOString().substring(0, 10),
      [`${media.dateParam}.gte`]: new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().substring(0, 10),
      'vote_count.gte': query?.minVotes || this.minVotes,
      with_genres: Array.isArray(query?.wg) ? query?.wg.join('|') : query?.wg,
      without_genres: Array.isArray(query?.wog) ? query?.wog.join('|') : query?.wog,
      certification: media.certifications ? (Array.isArray(query?.wr) ? query?.wr.join('|') : query?.wr) : undefined,
      certification_country: media.certifications ? this.region : undefined,
      watch_region: this.region,
      with_watch_monetization_types: query?.streaming ? media.monetization : ''
    }

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') {
        delete params[key]
      }
    }

    const urlParams = new URLSearchParams(params)
    const url = `${TMDB_API_URL}/discover/${media.path}?${urlParams}`
    const cacheKey = `${media.segment}/v${LIST_CACHE_VERSION}?${urlParams}`

    let data = await redis.getCache(cacheKey)
    if (data) return data

    const res = await fetch(url, { headers })

    if (!res.ok) throw new Error(`TMDB ${res.status} ${res.statusText}`)

    const json = await res.json()

    data = {
      [media.segment]: json.results.map(item => new Object({
        id: item.id,
        title: item[media.titleField],
        genres: item.genre_ids.map(id => genres.get(id)),
        genreIds: item.genre_ids,
        releaseDate: item[media.dateField],
        posterThumb: `${this.imgConfig.secure_base_url}${this.imgConfig.poster_sizes[0]}${item.poster_path}`,
        posterPath: item.poster_path,
        tmdbScore: item.vote_average,
        tmdbScoreCount: item.vote_count,
        popularity: item.popularity,
        detailPath: `/${media.segment}/${item.id}`
      }))
    }

    data.allGenres = genres
    data.withGenres = Array.isArray(query?.wg) ? query.wg : query?.wg ? [query.wg] : null // TODO: this should be nicer

    // TMDB offers no TV equivalent, which `filterRules` already reflects
    if (media.certifications) {
      data.allRatings = this.ratings
      data.withRatings = Array.isArray(query?.wr) ? query.wr : query?.wr ? [query.wr] : null // TODO: this should be nicer
    }

    data.allSorting = sorts
    data.sortBy = params.sort_by
    data.streamingNow = query?.streaming
    // Clamped because TMDB rejects a page past this. Undefined rather than NaN when absent: NaN
    // caches as null, and the job would multiply that to a zero expectation and accept page one.
    data.totalPages = Number.isFinite(json.total_pages) ? Math.min(json.total_pages, this.pageMax) : undefined
    data.totalResults = json.total_results

    redis.setCache(cacheKey, data)
    return data
  }

  async getMovieDetail(id) {
    return this.#getDetail('movie', id)
  }

  async getTvShowDetail(id) {
    return this.#getDetail('tv', id)
  }

  // The shared half of a detail lookup: the fetch, the provider reshaping, the trailer pick and the
  // fields both catalogues carry. What each adds sits in its `detail` entry, which returns its own
  // fields in its own order — the stored key order is part of the cached shape and of the API body.
  async #getDetail(mediaType, id) {
    const media = CATALOGUE[mediaType]
    const params = {
      append_to_response: media.append
    }
    const url = `${TMDB_API_URL}/${media.path}/${id}?${new URLSearchParams(params)}`
    const cacheKey = `${media.segment}/${id}/v${DETAIL_CACHE_VERSION}`

    let detail = await redis.getCache(cacheKey)
    if (detail) return detail

    const res = await fetch(url, { headers })

    // A 404 is the real answer that the title does not exist. Every other failure is
    // transient or ours, and callers must not see it as a missing title.
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`TMDB ${res.status} ${res.statusText}`)

    const json = await res.json()
    let providers = json['watch/providers'].results[this.region]

    if (providers) {
      // reshape, reduce, and mutate data
      const providerPriority = this.providerPriority.toReversed()
      const thisClass = this

      providers = Object.values(providers)
        .flat()
        .filter(function (item) {
          if (!item.provider_id) return // not a valid provider if no ID
          if (this.has(item.provider_id)) return // already in set
          if (thisClass.providerHidden.includes(item.provider_id)) return // hide obsolete providers

          item.logoUrl = thisClass.imgConfig.secure_base_url + thisClass.imgConfig.logo_sizes[0] + item.logo_path
          this.add(item.provider_id)
          return true
        }, new Set())
        .sort((a, b) => {
          const j = providerPriority.indexOf(a.provider_id)
          const k = providerPriority.indexOf(b.provider_id)
          return k - j
        })
    }
    const yt = json.videos.results.filter(item => /youtube/i.test(item.site))
    const ytTrailer = yt.find(item => /trailer/i.test(item.type)) || yt.find(item => /teaser|clip/i.test(item.type))
    const backdropUrl = json.backdrop_path ? this.imgConfig.secure_base_url + this.imgConfig.backdrop_sizes[2] + json.backdrop_path : null

    detail = {
      tmdbId: json.id,
      imdbId: json.external_ids.imdb_id,
      wikiId: json.external_ids.wikidata_id,
      title: json[media.titleField],
      overview: json.overview,
      releaseDate: json[media.dateField],
      tmdbScore: Math.round(json.vote_average * 10),
      ...media.detail(json, this.region),
      languages: json.spoken_languages.map(lang => lang.english_name).join(', '),
      genres: json.genres.map(genre => genre.name).join(', '),
      providers,
      backdropUrl,
      ytTrailerId: ytTrailer?.key
    }
    redis.setCache(cacheKey, detail)
    return detail
  }

  async getTitlesByString(str) {
    const limit = 10
    const urlParams = new URLSearchParams({
      query: str,
      language: this.language,
      region: this.region,
      include_adult: this.includeAdult,
    })
    const url = `${TMDB_API_URL}/search/multi?${urlParams}`

    const res = await fetch(url, { headers })

    if (!res.ok) throw new Error(`TMDB ${res.status} ${res.statusText}`)

    const json = await res.json()

    return json.results.filter(item => (item.media_type === 'tv' && item.first_air_date) || item.media_type === 'movie' && item.release_date)
      .slice(0, limit)
      .map(item => ({
        id: item.id,
        title: item.title || item.name,
        mediaType: item.media_type,
        mediaTypeText: item.media_type === 'tv' ? 'TV Show' : 'Movie',
        releaseDate: item.release_date || item.first_air_date,
        genres: item.genre_ids.map(id => this.genres.all.get(id)),
      }))
  }

}

export default new TmdbService()