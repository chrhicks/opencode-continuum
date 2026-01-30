#!/usr/bin/env bash
#
# Install continuum CLI globally
#
# Usage:
#   ./install.sh           # Install to ~/.local/bin
#   ./install.sh --global  # Install to /usr/local/bin (requires sudo)
#   ./install.sh --uninstall
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_SOURCE="$SCRIPT_DIR/src/cli.ts"
COMMAND_NAME="continuum"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

error() { echo -e "${RED}Error: $1${NC}" >&2; exit 1; }
success() { echo -e "${GREEN}$1${NC}"; }
warn() { echo -e "${YELLOW}$1${NC}"; }

# Check for bun
check_bun() {
  if ! command -v bun &> /dev/null; then
    error "bun is not installed. Install it from https://bun.sh"
  fi
}

# Determine install directory
get_install_dir() {
  if [[ "$1" == "--global" ]]; then
    echo "/usr/local/bin"
  else
    echo "$HOME/.local/bin"
  fi
}

# Create the wrapper script content
create_wrapper() {
  local cli_path="$1"
  cat << EOF
#!/usr/bin/env bash
exec bun "$cli_path" "\$@"
EOF
}

install() {
  local global_flag="$1"
  local install_dir
  install_dir=$(get_install_dir "$global_flag")
  local target="$install_dir/$COMMAND_NAME"

  check_bun

  # Verify source exists
  if [[ ! -f "$CLI_SOURCE" ]]; then
    error "CLI source not found at $CLI_SOURCE"
  fi

  # Create install directory if needed
  if [[ ! -d "$install_dir" ]]; then
    if [[ "$global_flag" == "--global" ]]; then
      sudo mkdir -p "$install_dir"
    else
      mkdir -p "$install_dir"
    fi
  fi

  # Create wrapper script
  local wrapper
  wrapper=$(create_wrapper "$CLI_SOURCE")

  if [[ "$global_flag" == "--global" ]]; then
    echo "$wrapper" | sudo tee "$target" > /dev/null
    sudo chmod +x "$target"
  else
    echo "$wrapper" > "$target"
    chmod +x "$target"
  fi

  success "Installed $COMMAND_NAME to $target"

  # Check if install dir is in PATH
  if [[ ":$PATH:" != *":$install_dir:"* ]]; then
    warn ""
    warn "Note: $install_dir is not in your PATH."
    warn "Add it to your shell config:"
    warn ""
    warn "  echo 'export PATH=\"$install_dir:\$PATH\"' >> ~/.bashrc"
    warn "  source ~/.bashrc"
    warn ""
  fi

  echo ""
  echo "Usage:"
  echo "  $COMMAND_NAME list              # List tasks"
  echo "  $COMMAND_NAME view <task_id>    # View task details"
  echo "  $COMMAND_NAME --help            # Show help"
}

uninstall() {
  local removed=0

  # Try ~/.local/bin
  local local_target="$HOME/.local/bin/$COMMAND_NAME"
  if [[ -f "$local_target" ]]; then
    rm "$local_target"
    success "Removed $local_target"
    removed=1
  fi

  # Try /usr/local/bin
  local global_target="/usr/local/bin/$COMMAND_NAME"
  if [[ -f "$global_target" ]]; then
    sudo rm "$global_target"
    success "Removed $global_target"
    removed=1
  fi

  if [[ $removed -eq 0 ]]; then
    warn "$COMMAND_NAME is not installed"
  fi
}

# Main
case "${1:-}" in
  --uninstall)
    uninstall
    ;;
  --global)
    install "--global"
    ;;
  --help|-h)
    echo "Install continuum CLI globally"
    echo ""
    echo "Usage:"
    echo "  ./install.sh           Install to ~/.local/bin"
    echo "  ./install.sh --global  Install to /usr/local/bin (requires sudo)"
    echo "  ./install.sh --uninstall  Remove installation"
    ;;
  "")
    install ""
    ;;
  *)
    error "Unknown option: $1"
    ;;
esac
