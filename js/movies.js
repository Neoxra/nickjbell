/* ============================================================================
   MOVIES PAGE LOGIC
   ----------------------------------------------------------------------------
   - TMDB:      search-as-you-type, posters, year, genre, rating, detail modal
   - Firestore: one shared public "movies" collection, live via onSnapshot
   - Filter / sort bar + community upvotes
   You should not need to edit this file — all keys live in movies-config.js.
   ============================================================================ */
(function () {
  "use strict";

  var cfg = window.MOVIES_CONFIG || {};

  // TMDB genre id -> name. Used to bucket the wall into categories.
  // Includes both movie and TV genre ids; TV-only ids are merged into the
  // nearest movie bucket where sensible so films & shows share categories.
  var GENRES = {
    // movie + shared
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy",
    80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
    14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
    9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 10770: "TV Movie",
    53: "Thriller", 10752: "War", 37: "Western",
    // TV-only
    10759: "Action", 10762: "Family", 10763: "News", 10764: "Reality",
    10765: "Sci-Fi", 10766: "Soap", 10767: "Talk", 10768: "War"
  };

  var TMDB_IMG = "https://image.tmdb.org/t/p/w342";
  var TMDB_BACKDROP = "https://image.tmdb.org/t/p/w780";
  var POSTER_PLACEHOLDER =
    "data:image/svg+xml;utf8," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="342" height="513">' +
      '<rect width="100%" height="100%" fill="#161616"/>' +
      '<text x="50%" y="50%" fill="#E3AE57" font-family="sans-serif" ' +
      'font-size="20" text-anchor="middle" dominant-baseline="middle">' +
      'No poster</text></svg>');

  // ---- helpers --------------------------------------------------------------

  function configured() {
    return cfg.firebase &&
      cfg.firebase.apiKey &&
      cfg.firebase.apiKey.indexOf("PASTE_") !== 0 &&
      cfg.tmdbApiKey &&
      cfg.tmdbApiKey.indexOf("PASTE_") !== 0;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function genreName(id) { return GENRES[id] || "Other"; }
  function primaryGenre(ids) { return (ids && ids.length) ? genreName(ids[0]) : "Other"; }

  // Normalize a TMDB search result (movie OR tv) into one shape.
  function norm(m) {
    var mt = m.media_type || (m.title ? "movie" : "tv");
    return {
      tmdbId:      m.id,
      mediaType:   mt,
      title:       m.title || m.name || "",
      date:        m.release_date || m.first_air_date || "",
      posterPath:  m.poster_path || null,
      genreIds:    m.genre_ids || [],
      voteAverage: (typeof m.vote_average === "number") ? m.vote_average : null,
      overview:    m.overview || ""
    };
  }
  function mediaLabel(t) { return t === "tv" ? "TV" : "Film"; }

  // Case/whitespace-insensitive key for a submitter name; "" and "anon" -> anon.
  function nameKey(s) {
    var t = (s == null ? "" : String(s)).trim().toLowerCase();
    return (t === "" || t === "anon") ? "anon" : t;
  }
  // Distinct submitters across the wall: [{key, display, count}], sorted.
  function peopleList() {
    var map = {};
    allDocs.forEach(function (d) {
      var k = nameKey(d.addedBy);
      if (!map[k]) {
        map[k] = { key: k, display: (k === "anon" ? "Anonymous" : String(d.addedBy).trim()), count: 0 };
      }
      map[k].count++;
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) {
        if (a.key === "anon") return 1;          // keep Anonymous last
        if (b.key === "anon") return -1;
        return a.display.localeCompare(b.display);
      });
  }
  // Map a freshly typed name to an existing canonical display (so "nick" reuses "Nick").
  function canonicalName(input) {
    var k = nameKey(input);
    if (k === "anon") return "anon";
    var found = peopleList().filter(function (p) { return p.key === k; })[0];
    return found ? found.display : String(input).trim();
  }

  // unified TMDB GET — accepts a v4 bearer token (JWT) or a v3 api_key
  function tmdbGet(path, query) {
    var token = cfg.tmdbApiKey || "";
    var q = query || "";
    var url = "https://api.themoviedb.org/3" + path + (q ? "?" + q : "");
    if (token.indexOf("eyJ") === 0) {
      return $.ajax({ url: url, headers: { Authorization: "Bearer " + token } });
    }
    return $.getJSON(url + (q ? "&" : "?") + "api_key=" + encodeURIComponent(token));
  }

  // localStorage vote guard (one upvote per browser per movie; not security)
  function getVoted() {
    try { return JSON.parse(localStorage.getItem("movieVotes") || "[]"); }
    catch (e) { return []; }
  }
  function saveVoted(arr) {
    try { localStorage.setItem("movieVotes", JSON.stringify(arr)); } catch (e) {}
  }
  function setVoted(id, on) {
    var v = getVoted().filter(function (x) { return x !== id; });
    if (on) v.push(id);
    saveVoted(v);
  }

  // ---- not-yet-configured notice -------------------------------------------

  if (!configured()) {
    $(function () {
      $("#movies-status")
        .removeClass("hidden")
        .html('<i class="fa fa-cog fa-spin"></i> The movie wall isn\'t connected yet. ' +
              'Add your Firebase &amp; TMDB keys in <code>js/movies-config.js</code> ' +
              '(see <code>MOVIES_SETUP.md</code>) to bring it to life.');
      $("#movie-search, #add-movie-btn").prop("disabled", true);
      $(".movies-controls").addClass("hidden");
      $("#movies-wall").html('<p class="wall-empty">Wall will appear here once connected.</p>');
    });
    return;
  }

  // ---- Firebase init --------------------------------------------------------

  firebase.initializeApp(cfg.firebase);

  if (cfg.recaptchaSiteKey) {
    try { firebase.appCheck().activate(cfg.recaptchaSiteKey, true); }
    catch (e) { console.warn("App Check not activated:", e); }
  }

  var db = firebase.firestore();
  var moviesRef = db.collection("movies");

  // ---- state ----------------------------------------------------------------

  var allDocs = [];
  var view = { filter: "", genre: "All", sort: "recent", media: "all", person: "all" };
  var selected = null; // TMDB result the user picked to add

  // ---- TMDB search (add box) ------------------------------------------------

  var searchTimer = null;

  function tmdbSearch(query) {
    // /search/multi returns movies, TV shows and people — keep movies + TV.
    tmdbGet("/search/multi", "include_adult=false&query=" + encodeURIComponent(query))
      .done(function (data) {
        var results = ((data && data.results) || [])
          .filter(function (m) { return m.media_type === "movie" || m.media_type === "tv"; })
          .map(norm);
        renderSuggestions(results);
      })
      .fail(function () {
        $("#movie-suggestions")
          .html('<li class="ms-empty">TMDB lookup failed — check your API key.</li>')
          .removeClass("hidden");
      });
  }

  function renderSuggestions(results) {
    var $box = $("#movie-suggestions");
    results = results.slice(0, 8);
    if (!results.length) {
      $box.html('<li class="ms-empty">No matches.</li>').removeClass("hidden");
      return;
    }
    var html = results.map(function (m, i) {
      var year = (m.date || "").slice(0, 4);
      var thumb = m.posterPath ? TMDB_IMG + m.posterPath : POSTER_PLACEHOLDER;
      return '<li class="ms-item" data-i="' + i + '">' +
        '<img src="' + esc(thumb) + '" alt="">' +
        '<span class="ms-title">' + esc(m.title) +
        (year ? ' <em>(' + esc(year) + ')</em>' : '') + '</span>' +
        '<span class="ms-type">' + esc(mediaLabel(m.mediaType)) + '</span>' +
        '<span class="ms-genre">' + esc(primaryGenre(m.genreIds)) + '</span>' +
        '</li>';
    }).join("");
    $box.data("results", results).html(html).removeClass("hidden");
  }

  function pick(item) {
    selected = item; // already normalized
    var year = (item.date || "").slice(0, 4);
    $("#movie-search").val(item.title + (year ? " (" + year + ")" : ""));
    $("#movie-suggestions").addClass("hidden").empty();
    $("#add-movie-btn").prop("disabled", false);
  }

  // ---- add to Firestore -----------------------------------------------------

  function addMovie() {
    if (!selected) return;

    if (allDocs.some(function (d) {
      return d.tmdbId === selected.tmdbId && (d.mediaType || "movie") === selected.mediaType;
    })) {
      flash("That one's already on the wall 👍");
      resetForm();
      return;
    }

    var doc = {
      tmdbId:      selected.tmdbId,
      mediaType:   selected.mediaType,
      title:       selected.title,
      year:        parseInt((selected.date || "").slice(0, 4), 10) || null,
      posterPath:  selected.posterPath || null,
      genre:       primaryGenre(selected.genreIds),
      genreIds:    selected.genreIds || [],
      voteAverage: (typeof selected.voteAverage === "number") ? selected.voteAverage : null,
      overview:    (selected.overview || "").slice(0, 1000) || null,
      votes:       0,
      addedBy:     canonicalName($("#movie-author").val()).slice(0, 40),
      createdAt:   firebase.firestore.FieldValue.serverTimestamp()
    };

    $("#add-movie-btn").prop("disabled", true).text("Adding…");
    moviesRef.add(doc)
      .then(function () { flash("Added 🍿"); resetForm(); })
      .catch(function (err) {
        console.error(err);
        flash("Couldn't add that — try again.");
        $("#add-movie-btn").prop("disabled", false).text("Add to wall");
      });
  }

  function resetForm() {
    selected = null;
    $("#movie-search").val("");
    $("#movie-suggestions").addClass("hidden").empty();
    $("#add-movie-btn").prop("disabled", true).text("Add to wall");
  }

  function flash(msg) {
    $("#add-feedback").stop(true, true).text(msg).fadeIn(150);
    setTimeout(function () { $("#add-feedback").fadeOut(600); }, 2500);
  }

  // ---- upvotes --------------------------------------------------------------

  // Toggle a like: clicking again removes it (decrement).
  function vote(id) {
    var has = getVoted().indexOf(id) !== -1;
    var delta = has ? -1 : 1;

    // Optimistic: update local state + re-render now (Firestore's local write
    // triggers onSnapshot immediately, before the server round-trip resolves).
    setVoted(id, !has); render();

    moviesRef.doc(id).update({ votes: firebase.firestore.FieldValue.increment(delta) })
      .catch(function (e) {
        console.error(e);
        setVoted(id, has); // roll back
        render();
        flash("Couldn't update your like.");
      });
  }

  // ---- detail modal ---------------------------------------------------------

  function openModal(tmdbId, mediaType) {
    mediaType = (mediaType === "tv") ? "tv" : "movie";
    var $m = $("#movie-modal");
    $("#mm-body").html('<p class="mm-loading"><i class="fa fa-circle-o-notch fa-spin"></i> Loading…</p>');
    $m.removeClass("hidden");
    $("body").addClass("modal-open-movies");

    tmdbGet("/" + mediaType + "/" + encodeURIComponent(tmdbId), "append_to_response=videos")
      .done(function (m) { $("#mm-body").html(modalHtml(m, mediaType)); })
      .fail(function () {
        $("#mm-body").html('<p class="mm-loading">Couldn\'t load details. ' +
          '<a target="_blank" rel="noopener" href="https://www.themoviedb.org/' + mediaType + '/' +
          encodeURIComponent(tmdbId) + '">View on TMDB</a></p>');
      });
  }

  function closeModal() {
    $("#movie-modal").addClass("hidden");
    $("body").removeClass("modal-open-movies");
  }

  function modalHtml(m, mediaType) {
    var isTv = mediaType === "tv";
    var title = m.title || m.name || "";
    var year = ((isTv ? m.first_air_date : m.release_date) || "").slice(0, 4);
    var rating = m.vote_average ? m.vote_average.toFixed(1) : null;
    var runtime;
    if (isTv) {
      runtime = m.number_of_seasons
        ? m.number_of_seasons + (m.number_of_seasons === 1 ? " season" : " seasons") : null;
    } else {
      runtime = m.runtime ? m.runtime + " min" : null;
    }
    var genres = (m.genres || []).map(function (g) { return g.name; }).join(" · ");
    var backdrop = m.backdrop_path ? TMDB_BACKDROP + m.backdrop_path
                 : (m.poster_path ? TMDB_IMG + m.poster_path : "");

    var trailer = null;
    var vids = (m.videos && m.videos.results) || [];
    for (var i = 0; i < vids.length; i++) {
      if (vids[i].site === "YouTube" &&
          (vids[i].type === "Trailer" || vids[i].type === "Teaser")) {
        trailer = "https://www.youtube.com/watch?v=" + vids[i].key; break;
      }
    }

    var meta = [(isTv ? "TV series" : "Film"), year, runtime, genres].filter(Boolean).join("  ·  ");
    var tmdbUrl = "https://www.themoviedb.org/" + (isTv ? "tv" : "movie") + "/" + encodeURIComponent(m.id);

    return (backdrop ? '<div class="mm-backdrop" style="background-image:url(\'' +
              esc(backdrop) + '\')"></div>' : '') +
      '<div class="mm-content">' +
        '<h3>' + esc(title) + '</h3>' +
        (rating ? '<span class="mm-rating"><i class="fa fa-star"></i> ' + esc(rating) + '</span>' : '') +
        '<p class="mm-meta">' + esc(meta) + '</p>' +
        '<p class="mm-overview">' + esc(m.overview || "No description available.") + '</p>' +
        '<div class="mm-actions">' +
          (trailer ? '<a class="mm-btn mm-btn-primary" target="_blank" rel="noopener" href="' +
            esc(trailer) + '"><i class="fa fa-play"></i> Watch trailer</a>' : '') +
          '<a class="mm-btn" target="_blank" rel="noopener" href="' + esc(tmdbUrl) +
            '">View on TMDB</a>' +
        '</div>' +
      '</div>';
  }

  // ---- live render ----------------------------------------------------------

  function comparator(sort) {
    if (sort === "title") return function (a, b) { return (a.title || "").localeCompare(b.title || ""); };
    if (sort === "year")  return function (a, b) { return (b.year || 0) - (a.year || 0); };
    if (sort === "votes") return function (a, b) { return (b.votes || 0) - (a.votes || 0); };
    // recent (default) — by createdAt desc
    return function (a, b) {
      var am = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      var bm = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return bm - am;
    };
  }

  function renderChips() {
    var present = {};
    allDocs.forEach(function (d) { present[d.genre || "Other"] = true; });
    var cats = ["All"].concat(Object.keys(present).sort());
    var html = cats.map(function (c) {
      return '<button class="genre-chip' + (view.genre === c ? " active" : "") +
        '" data-genre="' + esc(c) + '">' + esc(c) + '</button>';
    }).join("");
    $("#genre-chips").html(html);
  }

  function renderPeople() {
    var people = peopleList();

    // submitter filter dropdown (preserve current selection if still present)
    if (view.person !== "all" && !people.some(function (p) { return p.key === view.person; })) {
      view.person = "all";
    }
    var opts = '<option value="all">All people</option>' +
      people.map(function (p) {
        return '<option value="' + esc(p.key) + '"' +
          (view.person === p.key ? ' selected' : '') + '>' +
          esc(p.display) + ' (' + p.count + ')</option>';
      }).join("");
    $("#person-filter").html(opts);

    // autocomplete list for the "your name" submit field (skip Anonymous)
    var datalist = people
      .filter(function (p) { return p.key !== "anon"; })
      .map(function (p) { return '<option value="' + esc(p.display) + '"></option>'; })
      .join("");
    $("#people-list").html(datalist);
  }

  function render() {
    renderChips();
    renderPeople();

    var voted = getVoted();
    var docs = allDocs.slice();

    if (view.media !== "all") {
      docs = docs.filter(function (d) { return (d.mediaType || "movie") === view.media; });
    }
    if (view.person !== "all") {
      docs = docs.filter(function (d) { return nameKey(d.addedBy) === view.person; });
    }
    if (view.genre !== "All") {
      docs = docs.filter(function (d) { return (d.genre || "Other") === view.genre; });
    }
    if (view.filter) {
      var q = view.filter.toLowerCase();
      docs = docs.filter(function (d) { return (d.title || "").toLowerCase().indexOf(q) !== -1; });
    }
    docs.sort(comparator(view.sort));

    if (!allDocs.length) {
      $("#movies-wall").html('<p class="wall-empty">No movies yet — be the first to add one above.</p>');
      return;
    }
    if (!docs.length) {
      $("#movies-wall").html('<p class="wall-empty">Nothing matches that filter.</p>');
      return;
    }

    // bucket by genre (preserving the sorted order)
    var buckets = {}, order = [];
    docs.forEach(function (m) {
      var g = m.genre || "Other";
      if (!buckets[g]) { buckets[g] = []; order.push(g); }
      buckets[g].push(m);
    });
    order.sort();

    var html = order.map(function (cat) {
      var cards = buckets[cat].map(function (m) {
        var poster = m.posterPath ? TMDB_IMG + m.posterPath : POSTER_PLACEHOLDER;
        var hasVoted = voted.indexOf(m._id) !== -1;
        var mt = m.mediaType || "movie";
        var badge = (typeof m.voteAverage === "number" && m.voteAverage > 0)
          ? '<span class="mc-rating"><i class="fa fa-star"></i> ' + m.voteAverage.toFixed(1) + '</span>' : '';
        var typeTag = (mt === "tv") ? '<span class="mc-type">TV</span>' : '';
        return '<div class="movie-card" data-tmdb="' + esc(m.tmdbId) +
          '" data-media="' + esc(mt) + '" tabindex="0">' +
          '<div class="mc-poster">' +
            '<img loading="lazy" src="' + esc(poster) + '" alt="' + esc(m.title) + ' poster">' +
            badge + typeTag +
          '</div>' +
          '<div class="mc-info">' +
            '<h4>' + esc(m.title) + '</h4>' +
            '<span class="mc-meta">' + (m.year ? esc(m.year) : '') +
              (m.addedBy && m.addedBy !== "anon" ? ' · ' + esc(m.addedBy) : '') + '</span>' +
            '<button class="mc-vote' + (hasVoted ? ' voted' : '') + '" data-id="' + esc(m._id) +
              '" title="' + (hasVoted ? 'Remove your like' : 'Love this') + '">' +
              '<i class="fa fa-heart"></i> <span>' + (m.votes || 0) + '</span></button>' +
          '</div>' +
        '</div>';
      }).join("");
      return '<section class="movie-cat">' +
        '<h2 class="cat-title">' + esc(cat) +
        ' <span class="cat-count">' + buckets[cat].length + '</span></h2>' +
        '<div class="movie-grid">' + cards + '</div></section>';
    }).join("");

    $("#movies-wall").html(html);
  }

  // ---- wire up --------------------------------------------------------------

  $(function () {
    var $search = $("#movie-search");

    $search.on("input", function () {
      selected = null;
      $("#add-movie-btn").prop("disabled", true);
      var q = $.trim($(this).val());
      clearTimeout(searchTimer);
      if (q.length < 2) { $("#movie-suggestions").addClass("hidden").empty(); return; }
      searchTimer = setTimeout(function () { tmdbSearch(q); }, 250);
    });

    $("#movie-suggestions").on("click", ".ms-item", function () {
      var results = $("#movie-suggestions").data("results") || [];
      var m = results[parseInt($(this).attr("data-i"), 10)];
      if (m) pick(m);
    });

    $("#add-movie-btn").on("click", addMovie);

    // filter / sort controls
    $("#wall-filter").on("input", function () { view.filter = $.trim($(this).val()); render(); });
    $("#wall-sort").on("change", function () { view.sort = $(this).val(); render(); });
    $("#person-filter").on("change", function () { view.person = $(this).val(); render(); });
    $("#genre-chips").on("click", ".genre-chip", function () {
      view.genre = $(this).attr("data-genre"); render();
    });
    $("#media-toggle").on("click", ".media-btn", function () {
      view.media = $(this).attr("data-media-filter");
      $("#media-toggle .media-btn").removeClass("active");
      $(this).addClass("active");
      render();
    });

    // wall interactions (delegated)
    $("#movies-wall")
      .on("click", ".mc-vote", function (e) {
        e.stopPropagation();
        vote($(this).attr("data-id"));
      })
      .on("click", ".movie-card", function () {
        openModal($(this).attr("data-tmdb"), $(this).attr("data-media"));
      })
      .on("keydown", ".movie-card", function (e) {
        if (e.which === 13 || e.which === 32) {
          e.preventDefault();
          openModal($(this).attr("data-tmdb"), $(this).attr("data-media"));
        }
      });

    // modal close
    $("#movie-modal").on("click", ".mm-close, .mm-overlay", closeModal);
    $(document).on("keydown", function (e) { if (e.which === 27) closeModal(); });

    // close suggestions on outside click
    $(document).on("click", function (e) {
      if (!$(e.target).closest(".movie-add-box").length) {
        $("#movie-suggestions").addClass("hidden");
      }
    });

    // live subscription
    moviesRef.onSnapshot(function (snap) {
      allDocs = [];
      snap.forEach(function (d) {
        var data = d.data();
        data._id = d.id;
        allDocs.push(data);
      });
      render();
    }, function (err) {
      console.error(err);
      $("#movies-status").removeClass("hidden")
        .text("Couldn't load the movie wall — check Firestore rules.");
    });
  });

})();
