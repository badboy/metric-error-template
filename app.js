import { marked } from "./marked.esm.js";
import "./bz.js";

marked.use({
  gfm: true,
  breaks: true,
});

const bugzilla = bz.createClient();

class Templ {
  constructor(template) {
    this.template = template;
  }

  _scrub(val) {
    return new Option(val).innerHTML.replace(/"/g,"&quot;");
  }

  _get_value(vars, key) {
    var parts = key.split('.');
    while (parts.length) {
      if (!(parts[0] in vars)) {
        return false;
      }
      vars = vars[parts.shift()];
    }
    return vars;
  }

  _inner(fragment, vars) {
    let blockregex = /\{\{(([@!]?)(.+?))\}\}(([\s\S]+?)(\{\{:\1\}\}([\s\S]+?))?)\{\{\/\1\}\}/g;
    let valregex = /\{\{([=%])(.+?)\}\}/g;
    let self = this;

    return fragment
      .replace(blockregex, function(_, __, meta, key, inner, if_true, has_else, if_false) {

        var val = self._get_value(vars,key), temp = "", i;

        if (!val) {

          // handle if not
          if (meta == '!') {
            return render(inner, vars);
          }
          // check for else
          if (has_else) {
            return render(if_false, vars);
          }

          return "";
        }

        // regular if
        if (!meta) {
          return render(if_true, vars);
        }

        // process array/obj iteration
        if (meta == '@') {
          // store any previous vars
          // reuse existing vars
          _ = vars._key;
          __ = vars._val;
          for (i in val) {
            if (val.hasOwnProperty(i)) {
              vars._key = i;
              vars._val = val[i];
              temp += render(inner, vars);
            }
          }
          vars._key = _;
          vars._val = __;
          return temp;
        }

      })
      .replace(valregex, function(_, meta, key) {
        var val = self._get_value(vars,key);

        if (val || val === 0) {
          return meta == '%' ? self._scrub(val) : val;
        }
        return "";
      });
  }

  render(vars) {
    return this._inner(this.template, vars);
  }
}

class Cache {
  constructor() {
    this.cache = new Map();
  }

  async get(key, fn) {
    let obj = this.cache.get(key)
    if (!obj) {
      let newObj = await fn();
      this.cache.set(key, newObj);
      return newObj;
    }

    return obj;
  }
}

const CACHE = new Cache();

function debounce(func, wait, immediate) {
  let timeout;
  return function() {
    let context = this, args = arguments;
    let later = () => {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    let callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(context, args);
  };
};

async function cachedFetch(url) {
  return CACHE.get(url, async () => {
    let resp = await fetch(url);
    return await resp.json();
  });
}

const TEMPLATE = new Templ(`We're seeing an increase in {{=error}} metric errors for the [{{=metric}}]({{=metric_dictionary_url}}) metric.

Error: {{=error}}
Channel: {{=channel}}
Date range: {{=date_from}} to {{=date_to}}
Graph: {{=graph_url}}

* TODO

See also [the error reporting docs](https://mozilla.github.io/glean/book/user/metrics/error-reporting.html).
`);

const SQL_TEMPLATE = new Templ("https://sql.telemetry.mozilla.org/queries/131404/?p_appid={{=appid}}&p_channel={{=channel}}&p_date_range={{=start}}--{{=end}}&p_error_type={{=error}}&p_metric={{=metric}}#315970")
const BUG_TEMPLATE = new Templ("https://bugzilla.mozilla.org/enter_bug.cgi?product={{=product}}&component={{=component}}&blocked=1943045&short_desc={{=summary}}&comment={{=description}}")
const SUMMARY_TEMPLATE = new Templ("Increase in {{=error}} errors for {{=metric}} since {{=date_from}}");

const APPLICATION_MAP = {
  "firefox_desktop": "Firefox Desktop",
  "firefox_ios": "Firefox for iOS",
  "fenix": "Firefox for Android",
}

function dictionaryUrl(app, metric) {
  let cleanMetric = metric.replaceAll(".", "_");
  let url = `https://dictionary.telemetry.mozilla.org/apps/${app}/metrics/${cleanMetric}`;
  return url;
}

function redashUrl(appid, channel, start, end, error, metric) {
  return SQL_TEMPLATE.render({
    appid: appid,
    channel: channel,
    start: start,
    end: end,
    error: encodeURIComponent(error),
    metric: metric,
  });
}

function bugUrl(product, component, summary, description) {
  return BUG_TEMPLATE.render({
    product: encodeURIComponent(product),
    component: encodeURIComponent(component),
    summary: encodeURIComponent(summary),
    description: encodeURIComponent(description),
  })
}

const APP_MAP = new Map([
  ['firefox_desktop', 'firefox_desktop'],
  ['firefox_ios__release', 'org_mozilla_ios_firefox'],
  ['firefox_ios__beta', 'org_mozilla_ios_firefoxbeta'],
  ['firefox_ios__nightly', 'org_mozilla_ios_fennec'],
  ['fenix__release', 'org_mozilla_firefox'],
  ['fenix__beta', 'org_mozilla_firefox_beta'],
  ['fenix__nightly', 'org_mozilla_fenix'],
]);

function cleanAppId(application, channel) {
  let appid = APP_MAP.get(application);
  if (appid) {
    return appid;
  }

  return APP_MAP.get(application + "__" + channel);
}

async function getBug(bugId) {
  let queryParams = {};
  const include_fields = [
    "id",
    "product",
    "component",
  ].join(",");
  queryParams.include_fields = include_fields;

  return new Promise((resolve, reject) => {
    bugzilla.getBug(bugId, queryParams, (error, bugs) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(bugs);
    });
  });
}

async function renderTemplate() {
  let application = document.querySelector("select[name=application]").value;
  let channel = document.querySelector("select[name=channel]").value;
  let metric = document.querySelector("input[name=metric]").value;
  let error = document.querySelector("select[name=error]").value;
  let startDate = document.querySelector("input[name=start-date]").value;
  let endDate = document.querySelector("input[name=end-date]").value;

  let lowerChannel = channel.toLowerCase();
  let appid = cleanAppId(application, lowerChannel);
  let graphUrl = redashUrl(appid, lowerChannel, startDate, endDate, error, metric);

  let text = document.querySelector("textarea");
  let desc = TEMPLATE.render({
    channel: channel,
    metric: metric,
    error: error,
    date_from: startDate,
    date_to: endDate,
    metric_dictionary_url: dictionaryUrl(application, metric),
    graph_url: graphUrl,
  });
  text.value = desc;
  let mdout = document.querySelector("div#mdout");
  mdout.style.display = "block";
  mdout.innerHTML = marked.parse(desc);

  if (application && metric) {
    try {
      let url = `https://dictionary.telemetry.mozilla.org/data/${application}/index.json`;
      let data = await cachedFetch(url);
      if (data) {
        let metricData = data.metrics.find(e => e.name == metric);
        if (metricData) {
          let bug = metricData.bugs[0];
          let bugId = bug.match(/\d+/)[0]
          let bugData = await getBug(bugId);
          let summary = SUMMARY_TEMPLATE.render({ date_from: startDate, error, metric });
          let url = bugUrl(bugData.product, bugData.component, summary, desc);

          let urlOut = document.querySelector("#buglink");
          urlOut.innerHTML = "";

          let link = document.createElement("a");
          link.href = url;
          link.innerText = `File a bug (in ${bugData.product} :: ${bugData.component})`;
          link.target = "_blank";
          urlOut.appendChild(link);
        }
      }
    } catch (e) {
      console.log(`Failed to generate bug filing URL. Error: ${e}`);
    }
  }
}

function setMetricList(metrics) {
  let list = document.querySelector("#metric-list");
  while (list.firstChild) {
    list.removeChild(list.firstChild);
  }
  for (let metric of metrics) {
    let option = document.createElement("option");
    option.innerText = metric;
    list.appendChild(option);
  }
}

async function changeApplication(e) {
  let selected = e.target.value;
  if (selected != "") {
    let url = `https://dictionary.telemetry.mozilla.org/data/${selected}/index.json`;
    let data = await cachedFetch(url);
    let metrics = data.metrics.map(m => m.name);
    setMetricList(metrics);

    let metric = document.querySelector("input[name=metric]");
    let oldValue = metric.value;
    if (metrics.indexOf(oldValue) < 0) {
      metric.value = "";
    }
  }

  renderTemplate();
}

function preselectedTimeRange(e) {
  e.preventDefault();
  const target = e.target;

  let days = target.getAttribute('data-value')|0;
  let startDate = document.querySelector("[name=start-date]");
  let endDate = document.querySelector("[name=end-date]");
  let now = new Date;
  endDate.valueAsDate = now;
  now.setDate(now.getDate() - days);
  startDate.valueAsDate = now;

  renderTemplate();
}

async function main() {
  let input;

  input = document.querySelector("select[name=application]");
  input.addEventListener("change", (e) => (async () => await changeApplication(e))())

  input = document.querySelector("[name=metric]");
  input.addEventListener("keyup", (e) => renderTemplate());
  input.addEventListener("change", (e) => renderTemplate());

  input = document.querySelector("[name=error]");
  input.addEventListener("change", (e) => renderTemplate());

  input = document.querySelector("[name=channel]");
  input.addEventListener("change", (e) => renderTemplate());

  input = document.querySelector("[name=start-date]");
  input.addEventListener("change", (e) => renderTemplate());

  input = document.querySelector("[name=end-date]");
  input.addEventListener("change", (e) => renderTemplate());

  input = document.querySelectorAll("button.time-range");
  for (const button of input) {
    button.addEventListener("click", preselectedTimeRange);
  }

  renderTemplate();
}

document.addEventListener("DOMContentLoaded", () => {
  (async () => await main())();
});
