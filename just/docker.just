docker-build REGISTRY_PORT="5001" LOCAL="localhost" APP_NAME="backend":
    docker build -t {{ APP_NAME }} -f {{ APP_NAME }}/Dockerfile {{ APP_NAME }}
    docker tag {{ APP_NAME }}:latest {{ LOCAL }}:{{ REGISTRY_PORT }}/{{ APP_NAME }}:latest
    docker push {{ LOCAL }}:{{ REGISTRY_PORT }}/{{ APP_NAME }}:latest
