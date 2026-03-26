// Shared navigation for all docs pages.
// Each HTML page includes <script src="[../ if needed]nav.js"></script>
// inside an empty <nav> element. This script populates that <nav>
// and marks the current page's link as active.

(function () {
  // Determine path prefix based on directory depth.
  // Pages at docs/ root: prefix = ""
  // Pages in docs/packages/ or docs/background/: prefix = "../"
  var scriptEl = document.currentScript;
  var src = scriptEl ? scriptEl.getAttribute("src") : "";
  var prefix = src.indexOf("../") === 0 ? "../" : "";

  var navHTML =
    '<div class="nav-logo"><a href="' + prefix + 'index.html"><span>Montage</span> Concord</a></div>' +
    '<div class="nav-section">' +
      '<div class="nav-section-title">Overview</div>' +
      '<a href="' + prefix + 'index.html">Home</a>' +
      '<a href="' + prefix + 'architecture.html">Architecture</a>' +
      '<a href="' + prefix + 'data-flow.html">Data Flow</a>' +
    '</div>' +
    '<div class="nav-section">' +
      '<div class="nav-section-title">Packages — Implemented</div>' +
      '<a href="' + prefix + 'packages/core.html">Core</a>' +
      '<a href="' + prefix + 'packages/io.html">I/O</a>' +
      '<a href="' + prefix + 'packages/metrics-utils.html">Metrics Utils</a>' +
      '<a href="' + prefix + 'packages/metrics-univariate.html">Metrics Univariate</a>' +
      '<a href="' + prefix + 'packages/metrics-spectral.html">Metrics Spectral</a>' +
      '<a href="' + prefix + 'packages/viz.html">Visualization</a>' +
      '<a href="' + prefix + 'packages/server.html">Server (Backend)</a>' +
      '<a href="' + prefix + 'packages/frontend.html">Frontend (JS)</a>' +
      '<a href="' + prefix + 'packages/demo.html">Demo</a>' +
      '<a href="' + prefix + 'packages/models-utils.html">Models Utils</a>' +
      '<a href="' + prefix + 'packages/model-jansen-rit.html">Model: Jansen-Rit</a>' +
      '<a href="' + prefix + 'packages/model-wendling.html">Model: Wendling</a>' +
    '</div>' +
    '<div class="nav-section">' +
      '<div class="nav-section-title">Packages — Planned</div>' +
      '<a href="' + prefix + 'packages/future.html">Future Packages</a>' +
    '</div>' +
    '<div class="nav-section">' +
      '<div class="nav-section-title">Design</div>' +
      '<a href="' + prefix + 'ux-model-fitting.html">Model Fitting Workflow</a>' +
    '</div>' +
    '<div class="nav-section">' +
      '<div class="nav-section-title">Background Reading</div>' +
      '<a href="' + prefix + 'background/rest-api.html">REST API &amp; HTTP</a>' +
      '<a href="' + prefix + 'background/abc-pattern.html">Abstract Base Classes</a>' +
      '<a href="' + prefix + 'background/entry-points.html">Python Entry Points</a>' +
      '<a href="' + prefix + 'background/fastapi.html">FastAPI Framework</a>' +
      '<a href="' + prefix + 'background/es-modules.html">JS ES Modules</a>' +
      '<a href="' + prefix + 'background/neural-mass-models.html">Neural Mass Models</a>' +
    '</div>';

  var nav = scriptEl.closest("nav");
  nav.innerHTML = navHTML;

  // Mark the current page link as active.
  var path = window.location.pathname;
  var links = nav.querySelectorAll("a[href]");
  for (var i = 0; i < links.length; i++) {
    var href = links[i].getAttribute("href");
    // Match by filename: compare end of the current path with the href.
    // Strip prefix for comparison, then check if path ends with it.
    var target = href.replace(/^\.\.\//g, "");
    if (path.indexOf("/" + target) !== -1 || path.endsWith("/" + target)) {
      links[i].classList.add("active");
    }
  }
  // Load Mermaid.js for graphical diagrams (only renders if .mermaid blocks exist).
  // Deferred to DOMContentLoaded because nav.js runs inline before the rest of
  // the page body is parsed, so .mermaid elements don't exist yet.
  document.addEventListener("DOMContentLoaded", function () {
    if (!document.querySelector(".mermaid")) return;
    var s = document.createElement("script");
    s.type = "module";
    s.textContent =
      'import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";' +
      'mermaid.initialize({ startOnLoad: true, theme: "dark",' +
      '  themeVariables: {' +
      '    primaryColor: "#1a1d27",' +
      '    primaryTextColor: "#dde1f0",' +
      '    primaryBorderColor: "#5b8dee",' +
      '    lineColor: "#5b8dee",' +
      '    secondaryColor: "#22263a",' +
      '    tertiaryColor: "#22263a",' +
      '    background: "#0f1117",' +
      '    mainBkg: "#1a1d27",' +
      '    nodeBorder: "#2e3452",' +
      '    clusterBkg: "#22263a",' +
      '    clusterBorder: "#2e3452",' +
      '    edgeLabelBackground: "#1a1d27",' +
      '    fontSize: "14px"' +
      '  }' +
      '});';
    document.head.appendChild(s);
  });
})();
