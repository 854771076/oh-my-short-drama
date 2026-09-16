from dataclasses import dataclass, field
from types import MappingProxyType


@dataclass(frozen=True)
class RankingDefinition:
    title: str
    list_endpoint: str
    date_endpoint: str | None = None
    fixed_params: dict = field(default_factory=dict)


_RANKING_TYPES = {
    "hot": RankingDefinition(
        title="热力榜",
        date_endpoint="/playlet/getHotRankingDate",
        list_endpoint="/playlet/listHotRanking",
    ),
    "motion": RankingDefinition(
        title="动态漫榜",
        date_endpoint="/playlet/motionComicDate",
        list_endpoint="/playlet/motionComic",
        fixed_params={"rankType": 1},
    ),
    "motion-ai": RankingDefinition(
        title="真人AI榜",
        date_endpoint="/playlet/motionComicDate",
        list_endpoint="/playlet/motionComic",
        fixed_params={"rankType": 2},
    ),
    "motion-comedy": RankingDefinition(
        title="沙雕漫榜",
        date_endpoint="/playlet/motionComicDate",
        list_endpoint="/playlet/motionComic",
        fixed_params={"rankType": 3},
    ),
    "douyin": RankingDefinition(
        title="抖音热播榜",
        date_endpoint="/playlet/getNativePlayCountDate",
        list_endpoint="/playlet/selectNativePlayletPlayCountListByDate",
    ),
    "kuaishou": RankingDefinition(
        title="快手热播榜",
        date_endpoint="/playlet/getKuaishouNativePlayCountDate",
        list_endpoint="/playlet/selectKuaishouNativePlayletPlayCountListByDate",
    ),
    "hongguo": RankingDefinition(
        title="红果榜",
        date_endpoint="/playlet/listHongGuoRankingDate",
        list_endpoint="/playlet/listHongGuoRanking",
    ),
    "income": RankingDefinition(
        title="短剧收入榜",
        list_endpoint="/playlet/getPlayletRevenueRankData",
    ),
}

RANKING_TYPES = MappingProxyType(_RANKING_TYPES)


def get_ranking_definition(ranking_type):
    try:
        return RANKING_TYPES[ranking_type]
    except KeyError as exc:
        supported = ", ".join(RANKING_TYPES)
        raise ValueError(f"不支持的排行榜类型 {ranking_type!r}，可选值：{supported}") from exc

