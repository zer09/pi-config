import argparse
import os
import re
import signal
import stat
import subprocess
import sys
from pathlib import Path

PACKAGE = "@firecrawl/anydoc@0.2.4"
OFFICIAL_URL = "https://api.firecrawl.dev"
LOCAL_TIMEOUT = 120
HOSTED_TIMEOUT = 360


class ArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        # Do not echo unsupported credential or endpoint arguments.
        super().error("invalid arguments; use --help for supported options")


def diagnostic(message):
    values = []
    for name in ("FIRECRAWL_API_KEY", "FIRECRAWL_API_URL"):
        value = os.environ.get(name)
        if value and (name == "FIRECRAWL_API_KEY" or value.strip()):
            values.append(value)
    # Mask URLs before exact values can remove their scheme or '@'.
    # Match longest exact values in one pass so overlaps and new markers stay intact.
    if isinstance(message, bytes):
        message = re.sub(rb"https?://[^\s]*@[^\s]*", b"[redacted URL]", message, flags=re.IGNORECASE)
        values = [os.fsencode(value) for value in values]
        if values:
            pattern = b"|".join(re.escape(value) for value in sorted(values, key=len, reverse=True))
            message = re.sub(pattern, lambda _: b"[redacted]", message)
        message = message.decode("utf-8", errors="replace")
    else:
        message = re.sub(r"https?://[^\s]*@[^\s]*", "[redacted URL]", message, flags=re.IGNORECASE)
        if values:
            pattern = "|".join(re.escape(value) for value in sorted(values, key=len, reverse=True))
            message = re.sub(pattern, lambda _: "[redacted]", message)
    if message:
        print(message.rstrip("\n"), file=sys.stderr)


def check_output(source, output, overwrite, stdin_identity=None):
    # Reject parent symlinks too: overwrite authority applies to this named file only.
    for path in (output, *output.parents):
        if path.is_symlink():
            raise ValueError("output symlinks (including parent directories) are not supported")
    if source is not None:
        if output.resolve() == source.resolve():
            raise ValueError("output must not replace the input, even with --overwrite")
        if output.exists() and source.exists() and output.samefile(source):
            raise ValueError("output aliases the input; refusing to replace it")
    if output.exists():
        info = output.stat()
        if stdin_identity == (info.st_dev, info.st_ino):
            raise ValueError("output aliases redirected stdin; refusing to replace it")
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("output must be a regular file")
        if not overwrite:
            raise ValueError("output already exists; authorized replacement requires --overwrite")
        if info.st_nlink != 1:
            raise ValueError("--overwrite does not support multiply linked output files")


def write_output(source, output, overwrite, markdown, stdin_identity=None):
    check_output(source, output, overwrite, stdin_identity)
    flags = os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0)
    if not output.exists():
        flags |= os.O_CREAT | os.O_EXCL
    fd = os.open(output, flags, 0o666)
    with os.fdopen(fd, "wb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError("output must be a singly linked regular file")
        if stdin_identity == (info.st_dev, info.st_ino):
            raise ValueError("output aliases redirected stdin; refusing to replace it")
        if source is not None and source.exists():
            original = source.stat()
            if (info.st_dev, info.st_ino) == (original.st_dev, original.st_ino):
                raise ValueError("output aliases the input; refusing to replace it")
        # Truncate only after the opened file has passed the source/alias checks.
        stream.truncate(0)
        stream.write(markdown)


def run_anydoc(command, data, environment, timeout):
    process = subprocess.Popen(
        command,
        stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=environment,
        start_new_session=os.name == "posix",
    )
    try:
        stdout, stderr = process.communicate(input=data, timeout=timeout)
    except (subprocess.TimeoutExpired, KeyboardInterrupt):
        # npx may leave a Node child behind; kill the whole attempt on POSIX.
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
        process.wait(timeout=5)
        if process.stdin is not None:
            process.stdin.close()
        process.stdout.close()
        process.stderr.close()
        raise
    return process.returncode, stdout, stderr


def main(argv=None):
    parser = ArgumentParser(
        description=(
            "Convert one document locally, then automatically retry once with official "
            "Firecrawl OCR only if OCR is needed and FIRECRAWL_API_KEY is nonempty. "
            "The retry uploads the WHOLE PDF, including text pages; service privacy "
            "terms, possible costs and rate limits apply. Use --no-ocr to prohibit "
            "uploads. Local/hosted subprocess limits: 120/360 seconds."
        ),
        allow_abbrev=False,
    )
    parser.add_argument("input", help="document path or '-' for piped binary stdin")
    parser.add_argument("-o", "--output", help="authorized output file (default: stdout)")
    parser.add_argument("-f", "--format", help="input format override, e.g. csv for stdin")
    parser.add_argument("--no-ocr", action="store_true", help="local-only conversion; never upload for OCR")
    parser.add_argument("--overwrite", action="store_true", help="authorize replacement of an existing regular output file; no symlinks")
    args = parser.parse_args(argv)
    if args.overwrite and args.output is None:
        diagnostic("convert_document: --overwrite requires --output")
        return 2

    source = None
    output = None
    data = None
    stdin_identity = None
    try:
        if args.input != "-":
            # Keep '..' so the filesystem follows preceding symlinks before going up.
            source = Path.cwd() / Path(args.input)
        else:
            # Redirected files still have an identity even when the input is '-'.
            try:
                info = os.fstat(sys.stdin.fileno())
            except (OSError, ValueError):
                pass
            else:
                if stat.S_ISREG(info.st_mode):
                    stdin_identity = (info.st_dev, info.st_ino)
        if args.output is not None:
            output = Path.cwd() / Path(args.output)
            check_output(source, output, args.overwrite, stdin_identity)
        if source is None:
            if sys.stdin.isatty():
                diagnostic("convert_document: stdin is a terminal; pipe or redirect a document into '-' input")
                return 2
            data = sys.stdin.buffer.read()
    except ValueError as error:
        diagnostic(f"convert_document: {error}")
        return 1
    except (OSError, RuntimeError):
        diagnostic("convert_document: cannot read stdin or validate the input/output paths")
        return 1

    command = ["npx", "-y", PACKAGE]
    if args.format is not None:
        command.extend(["--format", args.format])
    command.extend(["--", str(source) if source is not None else "-"])
    environment = os.environ.copy()
    environment.pop("FIRECRAWL_API_KEY", None)
    environment.pop("FIRECRAWL_API_URL", None)
    hosted = False
    while True:
        mode = "hosted" if hosted else "reject"
        options = ["--ocr", mode]
        timeout = LOCAL_TIMEOUT
        if hosted:
            options.extend(["--api-url", OFFICIAL_URL])
            environment["FIRECRAWL_API_KEY"] = os.environ["FIRECRAWL_API_KEY"]
            timeout = HOSTED_TIMEOUT
        try:
            # Put wrapper-owned flags before '--', never let filenames become options.
            code, markdown, stderr = run_anydoc(
                command[:3] + options + command[3:], data, environment, timeout
            )
        except subprocess.TimeoutExpired:
            diagnostic(f"convert_document: {mode} attempt timed out after {timeout} seconds; no further retry")
            code = 1
        except OSError:
            diagnostic("convert_document: cannot launch or communicate with npx; check Node >=20 and npx")
            code = 1
        except KeyboardInterrupt:
            diagnostic("convert_document: conversion interrupted; no further retry")
            code = 1
        else:
            diagnostic(stderr)
            if code not in (0, 1, 2, 3):
                diagnostic("convert_document: AnyDoc terminated unexpectedly; no further retry")
                code = 1
            if code == 0:
                try:
                    if output is None:
                        sys.stdout.buffer.write(markdown)
                        sys.stdout.buffer.flush()
                    else:
                        write_output(source, output, args.overwrite, markdown, stdin_identity)
                except BrokenPipeError:
                    # Like the native CLI, an early downstream close is not a failure.
                    with open(os.devnull, "wb") as sink:
                        os.dup2(sink.fileno(), sys.stdout.fileno())
                except ValueError as error:
                    diagnostic(f"convert_document: {error}")
                    code = 1
                except (OSError, RuntimeError):
                    diagnostic("convert_document: cannot write the requested output")
                    code = 1
        if hosted:
            diagnostic(f"convert_document: hosted OCR used; result exit {code}")
            return code
        if code != 3:
            return code
        if args.no_ocr:
            diagnostic("convert_document: OCR needed; --no-ocr prohibits hosted upload")
            return 3
        if os.environ.get("FIRECRAWL_API_URL", OFFICIAL_URL) not in (OFFICIAL_URL, OFFICIAL_URL + "/"):
            diagnostic("convert_document: OCR needed; configured endpoint is not the exact official URL; separate approval/manual handling is required")
            return 3
        if not os.environ.get("FIRECRAWL_API_KEY"):
            diagnostic("convert_document: OCR needed; nonempty FIRECRAWL_API_KEY is required; no keyless fallback")
            return 3
        diagnostic("convert_document: retrying once with official Firecrawl OCR: the WHOLE PDF, including already-text pages, leaves this machine. Service privacy terms, possible costs and rate limits apply.")
        hosted = True


if __name__ == "__main__":
    raise SystemExit(main())
