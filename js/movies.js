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

  // TMDB movie genre id -> name. Used to bucket the wall into categories.
  var GENRES = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy",
    80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
    14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
    9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 10770: "TV Movie",
    53: "Thriller", 10752: "War", 37: "Western"
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
  var view = { filter: "", genre: "All", sort: "recent" };
  var selected = null; // TMDB result the user picked to add

  // ---- TMDB search (add box) ------------------------------------------------

  var searchTimer = null;

  function tmdbSearch(query) {
    tmdbGet("/search/movie", "include_adult=false&query=" + encodeURIComponent(query))
      .done(function (data) { renderSuggestions((data && data.results) || []); })
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
    var html = results.map(function (m) {
      var year = (m.release_date || "").slice(0, 4);
      var thumb = m.poster_path ? TMDB_IMG + m.poster_path : POSTER_PLACEHOLDER;
      return '<li class="ms-item" data-id="' + m.id + '">' +
        '<img src="' + esc(thumb) + '" alt="">' +
        '<span class="ms-title">' + esc(m.title) +
        (year ? ' <em>(' + esc(year) + ')</em>' : '') + '</span>' +
        '<span class="ms-genre">' + esc(primaryGenre(m.genre_ids)) + '</span>' +
        '</li>';
    }).join("");
    $box.data("results", results).html(html).removeClass("hidden");
  }

  function pick(movie) {
    selected = movie;
    var year = (movie.release_date || "").slice(0, 4);
    $("#movie-search").val(movie.title + (year ? " (" + year + ")" : ""));
    $("#movie-suggestions").addClass("hidden").empty();
    $("#add-movie-btn").prop("disabled", false);
  }

  // ---- add to Firestore -----------------------------------------------------

  function addMovie() {
    if (!selected) return;

    if (allDocs.some(function (d) { return d.tmdbId === selected.id; })) {
      flash("That one's already on the wall 👍");
      resetForm();
      return;
    }

    var doc = {
      tmdbId:      selected.id,
      title:       selected.title,
      year:        parseInt((selected.release_date || "").slice(0, 4), 10) || null,
      posterPath:  selected.poster_path || null,
      genre:       primaryGenre(selected.genre_ids),
      genreIds:    selected.genre_ids || [],
      voteAverage: (typeof selected.vote_average === "number") ? selected.vote_average : null,
      overview:    (selected.overview || "").slice(0, 1000) || null,
      votes:       0,
      addedBy:     ($("#movie-author").val() || "anon").slice(0, 40),
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

  function vote(id) {
    var voted = getVoted();
    if (voted.indexOf(id) !== -1) { flash("You've already loved this one ❤"); return; }
    moviesRef.doc(id).update({ votes: firebase.firestore.FieldValue.increment(1) })
      .then(function () { voted.push(id); saveVoted(voted); })
      .catch(function (e) { console.error(e); flash("Couldn't register your vote."); });
  }

  // ---- detail modal ---------------------------------------------------------

  function openModal(tmdbId) {
    var $m = $("#movie-modal");
    $("#mm-body").html('<p class="mm-loading"><i class="fa fa-circle-o-notch fa-spin"></i> Loading…</p>');
    $m.removeClass("hidden");
    $("body").addClass("modal-open-movies");

    tmdbGet("/movie/" + encodeURIComponent(tmdbId), "append_to_response=videos")
      .done(function (m) { $("#mm-body").html(modalHtml(m)); })
      .fail(function () {
        $("#mm-body").html('<p class="mm-loading">Couldn\'t load details. ' +
          '<a target="_blank" rel="noopener" href="https://www.themoviedb.org/movie/' +
          encodeURIComponent(tmdbId) + '">View on TMDB</a></p>');
      });
  }

  function closeModal() {
    $("#movie-modal").addClass("hidden");
    $("body").removeClass("modal-open-movies");
  }

  function modalHtml(m) {
    var year = (m.release_date || "").slice(0, 4);
    var rating = m.vote_average ? m.vote_average.toFixed(1) : null;
    var runtime = m.runtime ? m.runtime + " min" : null;
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

    var meta = [year, runtime, genres].filter(Boolean).join("  ·  ");
    var tmdbUrl = "https://www.themoviedb.org/movie/" + encodeURIComponent(m.id);

    return (backdrop ? '<div class="mm-backdrop" style="background-image:url(\'' +
              esc(backdrop) + '\')"></div>' : '') +
      '<div class="mm-content">' +
        '<h3>' + esc(m.title) + '</h3>' +
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

  function render() {
    renderChips();

    var voted = getVoted();
    var docs = allDocs.slice();

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
        var badge = (typeof m.voteAverage === "number" && m.voteAverage > 0)
          ? '<span class="mc-rating"><i class="fa fa-star"></i> ' + m.voteAverage.toFixed(1) + '</span>' : '';
        return '<div class="movie-card" data-tmdb="' + esc(m.tmdbId) + '" tabindex="0">' +
          '<div class="mc-poster">' +
            '<img loading="lazy" src="' + esc(poster) + '" alt="' + esc(m.title) + ' poster">' +
            badge +
          '</div>' +
          '<div class="mc-info">' +
            '<h4>' + esc(m.title) + '</h4>' +
            '<span class="mc-meta">' + (m.year ? esc(m.year) : '') +
              (m.addedBy && m.addedBy !== "anon" ? ' · ' + esc(m.addedBy) : '') + '</span>' +
            '<button class="mc-vote' + (hasVoted ? ' voted' : '') + '" data-id="' + esc(m._id) +
              '" title="Love this">' +
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
      var id = parseInt($(this).attr("data-id"), 10);
      var m = results.filter(function (r) { return r.id === id; })[0];
      if (m) pick(m);
    });

    $("#add-movie-btn").on("click", addMovie);

    // filter / sort controls
    $("#wall-filter").on("input", function () { view.filter = $.trim($(this).val()); render(); });
    $("#wall-sort").on("change", function () { view.sort = $(this).val(); render(); });
    $("#genre-chips").on("click", ".genre-chip", function () {
      view.genre = $(this).attr("data-genre"); render();
    });

    // wall interactions (delegated)
    $("#movies-wall")
      .on("click", ".mc-vote", function (e) {
        e.stopPropagation();
        vote($(this).attr("data-id"));
      })
      .on("click", ".movie-card", function () {
        openModal($(this).attr("data-tmdb"));
      })
      .on("keydown", ".movie-card", function (e) {
        if (e.which === 13 || e.which === 32) { e.preventDefault(); openModal($(this).attr("data-tmdb")); }
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
