# Docker Image

A minimal Docker image is available for the `jsontag-rest-server`.

The docker image can be created from the [`Dockerfile`](../Dockerfile) in the root of the repository.

The image is based on [alpine][1] with [NodeJS installed][2], rather than using the official NodeJS image. This is done to keep the image size down (from more than 200MB to less than 100MB).

## Installation

The image can be build from the Dockerfile provide by this project.

### Building the image

The image can be built using the following command:

```bash
docker build --tag jsontag-rest-server .
```

## Usage

To use the `jsontag-rest-server` container, two things are needed:

1. **The port the server is listening on needs to be exposed.**<br>
   This can be done by using the `--expose` flag when running the container. By default, this is port 3000. The port can be changed by setting the `NODE_PORT` environment variable (see the "Environment Variables" section). 

2. **A data file needs to be mounted into the container.**<br>
   The image comes with [a default dataset][3], loaded from `/app/data.jsontag` file that can be used to test the server. To use a different dataset, mount it into the container using the `--volume` flag when running the container.

To change the default for either the port or the data file, see the "Environment Variables" section.

An example of running the server (with the default data file and port):

```bash
docker run \
    --expose 3000 \
    --interactive \
    --name=jsontag-rest-server \
    --rm \
    --tty \
    --volume "$PWD/my-data.json:/app/data.jsontag"
    jsontag-rest-server
```

### Docker User

Similar to the official NodeJS image, the image is set up to run as a non-root user. The user and group are both `node`. The user is created with a UID of 1000 and a GID of 1000.

### Environment Variables

The runtime environment variables that can be set are:

- `DATAFILE`:  The file that is loaded into the REST server.<br>
  Defaults to `data.jsontag`.
- `NODE_ENV`:  The environment the server is running in.<br>
  Defaults to `production`.
- `NODE_PORT`: The port the server will listen on.<br>
  Defaults to `3000`.

These variables can be set when _building_ the Docker image:

```bash
docker build --tag jsontag-rest-server\
    --build-arg DATAFILE=my-data.jsontag \
    --build-arg NODE_ENV=development \
    --build-arg NODE_PORT=8080 \
    .
```

or when _running_ the Docker container
    
```bash
docker run \
    --env DATAFILE=my-data.jsontag \
    --env NODE_ENV=development \
    --env NODE_PORT=8080 \
    --expose 8080 \
    --volume "$PWD/my-data.json:/app/my-data.jsontag"    
    jsontag-rest-server
```

[1]: https://hub.docker.com/_/alpine
[2]: https://pkgs.alpinelinux.org/package/edge/main/x86/nodejs
[3]: ../data.jsontag
