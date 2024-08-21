import env from "../env.js"
import redis from "./redisService.js"

const { TMDB_TOKEN, TMDB_API_URL } = env
const headers = {
  accept: 'application/json',
  Authorization: `Bearer ${TMDB_TOKEN}`
}

class TmdbService {
  countMin = 50 // minimum vote count
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

  async getMovies(query) {
    const params = {
      // TODO: these params were based on deprecated filter and should be revisited
      page: query?.page ?? 1,
      include_adult: this.includeAdult,
      include_video: this.includeVideo,
      sort_by: query?.sort ?? this.sortingOptions.movies[0].value,
      'primary_release_date.lte': new Date().toISOString().substring(0, 10),
      'primary_release_date.gte': new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().substring(0, 10),
      'vote_count.gte': query?.count ?? this.countMin,
      with_genres: Array.isArray(query?.wg) ? query?.wg.join('|') : query?.wg,
      without_genres: query?.wog,
      certification: Array.isArray(query?.wr) ? query?.wr.join('|') : query?.wr,
      certification_country: this.region,
      watch_region: this.region,
      with_watch_monetization_types: query?.streaming ? 'buy|free|flatrate|rent' : ''
    }

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') {
        delete params[key]
      }
    }

    const urlParams = new URLSearchParams(params)
    const url = `${TMDB_API_URL}/discover/movie?${urlParams}`
    const cacheKey = `movies?${urlParams}`

    let data = await redis.getCache(cacheKey)
    if (data) return data

    try {
      const res = await fetch(url, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const json = await res.json()

      data = {
        movies: json.results.map(item => new Object({
          id: item.id,
          title: item.title,
          genres: item.genre_ids.map(id => this.genres.movie.get(id)),
          releaseDate: item.release_date,
          posterThumb: `${this.imgConfig.secure_base_url}${this.imgConfig.poster_sizes[0]}${item.poster_path}`,
          overview: item.overview,
          tmdbScore: item.vote_average,
          tmdbScoreCount: item.vote_count,
          popularity: item.popularity,
          detailPath: `/movies/${item.id}`
        }))
      }

      data.allGenres = this.genres.movie
      data.withGenres = Array.isArray(query?.wg) ? query.wg : query?.wg ? [query.wg] : null // TODO: this should be nicer
      data.allRatings = this.ratings
      data.withRatings = Array.isArray(query?.wr) ? query.wr : query?.wr ? [query.wr] : null // TODO: this should be nicer
      data.allSorting = this.sortingOptions.movies
      data.sortBy = params.sort_by
      data.streamingNow = query?.streaming

      redis.setCache(cacheKey, data)
      return data
    } catch (e) {
      console.error("Error fetching data:", e);
    }
  }

  async getMovieDetail(id) {
    const params = {
      append_to_response: 'videos,release_dates,watch/providers,external_ids,credits'
    }
    const url = `${TMDB_API_URL}/movie/${id}?${new URLSearchParams(params)}`
    const cacheKey = `movies/${id}`

    let movie = await redis.getCache(cacheKey)
    if (movie) return movie

    try {
      const res = await fetch(url, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

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
      const rating = json.release_dates.results.find(item => item.iso_3166_1 === this.region)?.release_dates.find(release => release.certification !== '')?.certification ?? ''
      const yt = json.videos.results.filter(item => /youtube/i.test(item.site))
      const ytTrailer = yt.find(item => /trailer/i.test(item.type)) || yt.find(item => /teaser|clip/i.test(item.type))
      const cast = json.credits.cast.slice(0, 5).map(item => item.name).join(', ')
      const director = json.credits.crew.filter(item => /^director$/i.test(item.job)).map(item => item.name).join(', ')
      const backdropUrl = json.backdrop_path ? this.imgConfig.secure_base_url + this.imgConfig.backdrop_sizes[2] + json.backdrop_path : null

      movie = {
        tmdbId: json.id,
        imdbId: json.external_ids.imdb_id,
        wikiId: json.external_ids.wikidata_id,
        title: json.title,
        overview: json.overview,
        releaseDate: json.release_date,
        tmdbScore: Math.round(json.vote_average * 10),
        rating,
        cast,
        director,
        runtime: json.runtime,
        languages: json.spoken_languages.map(lang => lang.english_name).join(', '),
        genres: json.genres.map(genre => genre.name).join(', '),
        providers,
        backdropUrl,
        ytTrailerId: ytTrailer?.key
      }
      redis.setCache(cacheKey, movie)
      return movie
    } catch (e) {
      console.error("Error fetching data:", e);
    }
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

    try {
      const res = await fetch(url, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

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
    } catch (e) {
      console.error("Error fetching data:", e);
    }
  }
  async getTvShows(query) {
    const params = {
      // TODO: these params were based on deprecated filter and should be revisited
      page: query?.page ?? 1,
      include_adult: this.includeAdult,
      sort_by: query?.sort ?? this.sortingOptions.shows[0].value,
      'first_air_date.lte': new Date().toISOString().substring(0, 10),
      'first_air_date.gte': new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().substring(0, 10),
      'vote_count.gte': query?.count ?? this.countMin,
      with_genres: Array.isArray(query?.wg) ? query?.wg.join('|') : query?.wg,
      without_genres: query?.wog,
      watch_region: this.region,
      with_watch_monetization_types: query?.streaming ? 'buy|free|flatrate|rent|ads' : ''
    }

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') {
        delete params[key]
      }
    }

    const urlParams = new URLSearchParams(params)
    const url = `${TMDB_API_URL}/discover/tv?${urlParams}`
    const cacheKey = `shows?${urlParams}`

    let data = await redis.getCache(cacheKey)
    if (data) return data

    try {
      const res = await fetch(url, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const json = await res.json()

      data = {
        shows: json.results.map(item => new Object({
          id: item.id,
          title: item.name,
          genres: item.genre_ids.map(id => this.genres.show.get(id)),
          releaseDate: item.first_air_date,
          posterThumb: `${this.imgConfig.secure_base_url}${this.imgConfig.poster_sizes[0]}${item.poster_path}`,
          overview: item.overview,
          tmdbScore: item.vote_average,
          tmdbScoreCount: item.vote_count,
          popularity: item.popularity,
          detailPath: `/shows/${item.id}`
        }))
      }

      data.allGenres = this.genres.show
      data.withGenres = Array.isArray(query?.wg) ? query.wg : query?.wg ? [query.wg] : null // TODO: this should be nicer
      data.allSorting = this.sortingOptions.shows
      data.sortBy = params.sort_by
      data.streamingNow = query?.streaming

      redis.setCache(cacheKey, data)
      return data
    } catch (e) {
      console.error("Error fetching data:", e);
    }
  }

  async getTvShowDetail(id) {
    const params = {
      append_to_response: 'videos,watch/providers,external_ids,aggregate_credits,content_ratings'
    }
    const url = `${TMDB_API_URL}/tv/${id}?${new URLSearchParams(params)}`
    const cacheKey = `shows/${id}`

    let show = await redis.getCache(cacheKey)
    if (show) return show

    try {
      const res = await fetch(url, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

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
      const cast = json.aggregate_credits.cast.slice(0, 5).map(item => item.name).join(', ')
      const director = json.aggregate_credits.crew.filter(item => /^director$/i.test(item.job)).map(item => item.name).join(', ')
      const backdropUrl = json.backdrop_path ? this.imgConfig.secure_base_url + this.imgConfig.backdrop_sizes[2] + json.backdrop_path : null

      show = {
        tmdbId: json.id,
        imdbId: json.external_ids.imdb_id,
        wikiId: json.external_ids.wikidata_id,
        title: json.name,
        overview: json.overview,
        releaseDate: json.release_date,
        tmdbScore: Math.round(json.vote_average * 10),
        cast,
        director,
        runtime: json.episode_run_time,
        languages: json.spoken_languages.map(lang => lang.english_name).join(', '),
        genres: json.genres.map(genre => genre.name).join(', '),
        providers,
        backdropUrl,
        ytTrailerId: ytTrailer?.key
      }
      redis.setCache(cacheKey, show)
      return show
    } catch (e) {
      console.error("Error fetching data:", e);
    }
  }

}

export default new TmdbService()