def _pyplot():
    try:
        import matplotlib.pyplot as plt
    except Exception as exc:
        raise RuntimeError(
            "matplotlib is not installed. Run `pip install matplotlib` to "
            "enable graph views."
        ) from exc
    return plt


def _safe_values(data):
    labels = list(data.keys())
    sizes = [max(float(data[label]), 0.0) for label in labels]
    return labels, sizes


def _present(fig, plt):
    try:
        manager = getattr(fig.canvas, "manager", None)
        if manager is not None and getattr(manager, "window", None) is not None:
            window = manager.window
            if getattr(window, "attributes", None):
                window.attributes("-topmost", True)
                try:
                    window.after(200, lambda: window.attributes("-topmost", False))
                except Exception:
                    pass
            if getattr(window, "lift", None):
                window.lift()
    except Exception:
        pass
    plt.show()


def show_allocation_pie(allocation_dict, key="sector_allocation"):
    plt = _pyplot()
    labels, sizes = _safe_values(allocation_dict[key])
    if not labels or sum(sizes) <= 0:
        print("No allocation data to plot.")
        return
    fig = plt.figure(figsize=(7, 7))
    plt.pie(sizes, labels=labels, autopct="%1.1f%%", startangle=140)
    plt.title("Sector allocation")
    plt.axis("equal")
    plt.tight_layout()
    _present(fig, plt)


def show_gainloss_bar(holdings):
    plt = _pyplot()
    tickers = [h["ticker"] for h in holdings]
    pcts = [h["gain_loss_pct"] for h in holdings]
    colors = ["#2e8b57" if p >= 0 else "#d9534f" for p in pcts]
    fig = plt.figure(figsize=(9, 5))
    plt.bar(tickers, pcts, color=colors)
    plt.axhline(0, color="gray", linewidth=0.8)
    plt.title("Gain/loss % by holding")
    plt.ylabel("Gain/loss %")
    plt.xticks(rotation=30, ha="right")
    plt.tight_layout()
    _present(fig, plt)


def show_rebalance_comparison(before_allocation, after_allocation):
    plt = _pyplot()
    before_labels, before_sizes = _safe_values(before_allocation["sector_allocation"])
    after_labels, after_sizes = _safe_values(after_allocation["sector_allocation"])
    if not before_labels:
        print("No allocation data to plot.")
        return
    fig, axes = plt.subplots(1, 2, figsize=(12, 6))
    axes[0].pie(
        before_sizes,
        labels=before_labels,
        autopct="%1.1f%%",
        startangle=140,
    )
    axes[0].set_title("Before")
    axes[0].axis("equal")
    if after_labels and sum(after_sizes) > 0:
        axes[1].pie(
            after_sizes,
            labels=after_labels,
            autopct="%1.1f%%",
            startangle=140,
        )
    axes[1].set_title("After")
    axes[1].axis("equal")
    fig.suptitle("Simulated rebalance: allocation comparison")
    fig.tight_layout()
    _present(fig, plt)