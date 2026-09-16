import argparse
import json

from .client import JuchachaRankingClient


def build_parser():
    parser = argparse.ArgumentParser(description="导出 DataEye 剧查查排行榜")
    parser.add_argument("--type", dest="ranking_type")
    parser.add_argument("--output")
    parser.add_argument("--day")
    parser.add_argument("--week")
    parser.add_argument("--month")
    parser.add_argument("--page-size", type=int, default=30)
    parser.add_argument("--max-pages", type=int)
    parser.add_argument("--all", action="store_true", dest="all_pages")
    parser.add_argument("--list-types", action="store_true")
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    client = JuchachaRankingClient()
    if args.list_types:
        print(json.dumps(client.supported_rankings(), ensure_ascii=False, indent=2))
        return 0
    if not args.ranking_type or not args.output:
        parser.error("除 --list-types 外，必须提供 --type 和 --output")
    kwargs = {
        "day": args.day,
        "week": args.week,
        "month": args.month,
        "page_size": args.page_size,
    }
    if args.all_pages:
        kwargs["max_pages"] = args.max_pages
    path = client.export_ranking(
        args.ranking_type,
        args.output,
        all_pages=args.all_pages,
        **kwargs,
    )
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
