# Environment Setup

This is a conda-managed project. To set up:

```bash
conda create -n concord python=3.11
conda activate concord
```

Install packages in dependency order using editable installs:

```bash
cd /path/to/concord  # cd to the project root
pip install -e ./concord-core
pip install -e ./concord-metrics-utils
pip install -e ./concord-models-utils
pip install -e ./concord-io
pip install -e ./concord-metrics-univariate
pip install -e ./concord-metrics-spectral
pip install -e ./concord-metrics-connectivity
pip install -e ./concord-metrics-network
pip install -e ./concord-metrics-nonlinear
pip install -e ./concord-metrics-event
pip install -e ./concord-model-jansen-rit
pip install -e ./concord-model-wendling
pip install -e ./concord-model-epileptor
pip install -e ./concord-model-robinson
pip install -e ./concord-connectome
pip install -e ./concord-fit
pip install -e ./concord-viz
pip install -e ./concord-server
```

The `concord-demo` package has no Python dependencies to install — it is a static site. To regenerate its baked data:

```bash
python concord-demo/record_demo.py
```

After adding a new dependency to any package's pyproject.toml, re-run `pip install -e ./that-package` to pick it up.
