"""Prometheus metrics.

Scope is deliberately narrow: the numbers needed to answer "is rendering
healthy, and how close to its ceiling is this instance". Rendering is the one
expensive thing this service does, so it is what is measured.

prometheus_client is a dependency rather than a hand-rolled exposition format —
unlike the rate limiter, which really is a deque of timestamps, histograms and
the text format have enough edge cases (bucket accumulation, label escaping,
`_created` series) that reimplementing them would be a liability, and the
client is the reference implementation.

Cardinality note: render metrics are labelled by template code. That is one
series per template, which is fine for the tens-to-hundreds a deployment has,
and is the label that makes the data useful ("which form got slow"). Ad-hoc
renders share a single `<ad-hoc>` label rather than minting a series each.
"""

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)

# A registry of our own instead of the process-global default: the default
# also carries process and GC collectors, and a test that asserts on output
# should not have to reason about those.
REGISTRY = CollectorRegistry()

AD_HOC = "<ad-hoc>"

render_duration_seconds = Histogram(
    "linform_render_duration_seconds",
    "Time to turn a rendered template into a PDF.",
    labelnames=("template_code", "outcome"),
    # A print form renders in well under a second; the long buckets exist to
    # show the tail that matters — a form creeping towards the 30s timeout.
    buckets=(0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60),
    registry=REGISTRY,
)

render_inflight = Gauge(
    "linform_render_inflight",
    "Renders currently in flight on this instance.",
    registry=REGISTRY,
)

render_concurrency_limit = Gauge(
    "linform_render_concurrency_limit",
    "In-flight ceiling; past it renders are shed with 429. Exposed so the "
    "gauge above can be read as utilisation rather than a bare number.",
    registry=REGISTRY,
)

render_rejected_total = Counter(
    "linform_render_rejected_total",
    "Renders shed because the in-flight ceiling was reached (answered 429).",
    registry=REGISTRY,
)

render_timeout_total = Counter(
    "linform_render_timeout_total",
    "Renders abandoned at the hard timeout (answered 504).",
    registry=REGISTRY,
)

login_failed_total = Counter(
    "linform_login_failed_total",
    "Rejected login attempts, by reason.",
    labelnames=("reason",),
    registry=REGISTRY,
)


def observe_render(template_code: str | None, outcome: str, seconds: float) -> None:
    render_duration_seconds.labels(
        template_code=template_code or AD_HOC, outcome=outcome
    ).observe(seconds)


def render_output() -> tuple[bytes, str]:
    """The exposition payload and the content type Prometheus expects."""
    return generate_latest(REGISTRY), CONTENT_TYPE_LATEST
