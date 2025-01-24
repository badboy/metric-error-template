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
    console.log("debouncing");
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
    return await fetch(url);
  });
}

const METRICS = [
  "browser.search.in_content",
  "localstorage.database.request_allow_to_close_response_time",
];

const TEMPLATE = new Templ(`We're seeing an increase in {{=error}} metric errors for the [{{=metric}}]({{=metric_dictionary_url}}) metric.

Error: {{=error}}
Channel: {{=channel}}
Date range: {{=date_from}} to {{=date_to}}
Looker graph: {{=looker_url}}

* TODO

See also [the docs](https://mozilla.github.io/glean/book/reference/metrics/labeled_counters.html#recorded-errors).
`);

const APPLICATION_MAP = {
  "firefox_desktop": "Firefox Desktop",
  "firefox_ios": "Firefox for iOS",
  "fenix": "Firefox for Android",
}

function dictionaryUrl(app, metric) {
  let cleanMetric = metric.replace(".", "_");
  let url = `https://dictionary.telemetry.mozilla.org/apps/${app}/metrics/${cleanMetric}`;
  return url;
}

function renderTemplate() {
  let application = document.querySelector("select[name=application]").value;
  let channel = document.querySelector("select[name=channel]").value;
  let metric = document.querySelector("input[name=metric]").value;
  let error = document.querySelector("select[name=error]").value;
  let startDate = document.querySelector("input[name=start-date]").value;
  let endDate = document.querySelector("input[name=end-date]").value;

  let text = document.querySelector("textarea");
  text.value = TEMPLATE.render({
    channel: channel,
    metric: metric,
    error: error,
    date_from: startDate,
    date_to: endDate,
    metric_dictionary_url: dictionaryUrl(application, metric),
  });
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
    let resp = await cachedFetch(url);
    let data = await resp.json();
    let metrics = data.metrics.map(m => m.name);
    setMetricList(metrics);

    let metric = document.querySelector("input[name=metric]");
    let oldValue = metric.value;
    window.e = metrics;
    if (metrics.indexOf(oldValue) < 0) {
      metric.value = "";
    }
  }

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
}

document.addEventListener("DOMContentLoaded", () => {
  (async () => await main())();
});
