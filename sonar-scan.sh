#!/bin/bash
set -euo pipefail

# Required flags
TOKEN=""
HOST_URL=""

usage() {
    echo "Usage: $0 --token <SONAR_TOKEN> --host <http://...:9000>"
    echo "Notes:"
    echo "  - Read ./sonar-project.properties and sets scanner -D[key]=(value)"
    exit 1
}

# ---- parse args (only --token and --host) ----
while [[ $# -gt 0 ]]; do
    case "$1" in
    --token)
        TOKEN="${2:-}"
        shift 2
        ;;
    --host)
        HOST_URL="${2:-}"
        shift 2
        ;;
    -h | --help) usage ;;
    *)
        echo "Unknown arg: $1"
        usage
        ;;
    esac
done

[[ -z "$TOKEN" || -z "$HOST_URL" ]] && usage
command -v docker >/dev/null || {
    echo "docker not found"
    exit 1
}

IMAGE="sonarsource/sonar-scanner-cli"
SRC_DIR="${PWD}"
VOL_ARG="-v ${SRC_DIR}:/usr/src"

SCANNER_ARGS=()
PROP_FILE="${SRC_DIR}/sonar-project.properties"
if [[ -f "$PROP_FILE" ]]; then
    # shellcheck disable=SC2016
    while IFS= read -r line; do
        # strip leading/trailing spaces
        line="${line#"${line%%[![:space:]]*}"}"
        line="${line%"${line##*[![:space:]]}"}"
        # skip comments/blank
        [[ -z "$line" || "$line" =~ ^# ]] && continue
        # only key=value lines
        if [[ "$line" =~ ^([^=[:space:]]+)[[:space:]]*=[[:space:]]*(.*)$ ]]; then
            key="${BASH_REMATCH[1]}"
            val="${BASH_REMATCH[2]}"
            # ignore these; we set them via env
            if [[ "$key" == "sonar.host.url" || "$key" == "sonar.login" ]]; then
                continue
            fi
            # keep value as-is (allow spaces); pass as a single -D arg
            SCANNER_ARGS+=("-D${key}=${val}")
        fi
    done <"$PROP_FILE"
else
    echo "Info: ${PROP_FILE} not found; running without -D props from file."
fi

DOCKER_ARGS=()
if [[ "$HOST_URL" =~ ^https?://(localhost|127\.0\.0\.1)(:|/) ]]; then
    if docker run --rm --network host hello-world >/dev/null 2>&1; then
        DOCKER_ARGS+=(--network host)
    else
        DOCKER_ARGS+=(--add-host=host.docker.internal:host-gateway)
        HOST_URL="${HOST_URL/localhost/host.docker.internal}"
        HOST_URL="${HOST_URL/127.0.0.1/host.docker.internal}"
    fi
else
    if docker inspect sonarqube >/dev/null 2>&1; then
        NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' sonarqube | head -n1 || true)"
        [[ -n "$NET" ]] && DOCKER_ARGS+=(--network "$NET")
    else
        NET_GUESS="$(docker network ls --format '{{.Name}}' | grep -E '_sonar-net$' | head -n1 || true)"
        [[ -n "$NET_GUESS" ]] && DOCKER_ARGS+=(--network "$NET_GUESS")
    fi
fi

echo "Scanner image : ${IMAGE}"
echo "Host URL      : ${HOST_URL}"
echo "Network args  : ${DOCKER_ARGS[*]:-(default)}"
echo "Source mount  : ${SRC_DIR} -> /usr/src"
if [[ ${#SCANNER_ARGS[@]} -gt 0 ]]; then
    echo "Properties : sonar-project.properties (${#SCANNER_ARGS[@]} entries)"
fi
echo

exec docker run --rm \
    "${DOCKER_ARGS[@]}" \
    -e SONAR_HOST_URL="${HOST_URL}" \
    -e SONAR_LOGIN="${TOKEN}" \
    -e SONAR_TOKEN="${TOKEN}" \
    ${VOL_ARG} \
    "${IMAGE}" \
    "${SCANNER_ARGS[@]}"
