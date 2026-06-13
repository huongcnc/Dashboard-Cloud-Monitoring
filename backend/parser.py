import re

def parse_syslog(lines):

    pattern = re.compile(
        r"^(?P<timestamp>\w+\s+\d+\s+\d+:\d+:\d+)\s+"
        r"(?P<host>\S+)\s+"
        r"(?P<service>[^\[:]+)"
        r"(?:\[(?P<pid>\d+)\])?:\s+"
        r"(?P<message>.*)$"
    )

    logs = []

    for line in lines:

        m = pattern.match(line.strip())

        if not m:
            continue

        logs.append(m.groupdict())

    return logs