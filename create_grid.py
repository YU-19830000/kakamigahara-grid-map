from __future__ import annotations

import json
import math
from pathlib import Path
from datetime import datetime
from typing import Any

from shapely.geometry import shape, mapping, box
from shapely.ops import transform, unary_union
from pyproj import CRS, Transformer


# ============================================================
# 各務原市 1kmグリッド生成スクリプト
# 入力:
#   data/kakamigahara_boundary.geojson
#
# 出力:
#   data/kakamigahara_boundary_6675_python.geojson
#   data/kakamigahara_grid_all_6675_python.geojson
#   data/kakamigahara_grid_6675_python.geojson
#   data/kakamigahara_grid.geojson
#   data/grid_summary.txt
# ============================================================

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"

INPUT_BOUNDARY = DATA_DIR / "kakamigahara_boundary.geojson"

OUT_BOUNDARY_6675 = DATA_DIR / "kakamigahara_boundary_6675_python.geojson"
OUT_GRID_ALL_6675 = DATA_DIR / "kakamigahara_grid_all_6675_python.geojson"
OUT_GRID_6675 = DATA_DIR / "kakamigahara_grid_6675_python.geojson"
OUT_GRID_WEB = DATA_DIR / "kakamigahara_grid.geojson"
OUT_SUMMARY = DATA_DIR / "grid_summary.txt"

GRID_SIZE_M = 1000

# 元データは国土数値情報由来のJGD2011緯度経度系として扱う。
# GeoJSONとしては経度・緯度の順で入っている想定。
SOURCE_CRS = CRS.from_epsg(6668)

# QGISでEPSG:6675が出ない環境でも確実に使えるよう、
# JGD2011 / Japan Plane Rectangular CS VII 相当をPROJ文字列で定義する。
TARGET_CRS_6675_CUSTOM = CRS.from_proj4(
    "+proj=tmerc "
    "+lat_0=36 "
    "+lon_0=137.166666666667 "
    "+k=0.9999 "
    "+x_0=0 "
    "+y_0=0 "
    "+ellps=GRS80 "
    "+towgs84=0,0,0,0,0,0,0 "
    "+units=m "
    "+no_defs "
    "+type=crs"
)

WEB_CRS = CRS.from_epsg(4326)


def read_geojson(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"入力ファイルが見つかりません: {path}")

    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_geojson(path: Path, features: list[dict[str, Any]], name: str) -> None:
    fc = {
        "type": "FeatureCollection",
        "name": name,
        "features": features,
    }

    with path.open("w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, separators=(",", ":"))

    print(f"出力しました: {path}")


def make_feature(geom, properties: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "Feature",
        "properties": properties,
        "geometry": mapping(geom),
    }


def load_boundary_geometry() -> Any:
    data = read_geojson(INPUT_BOUNDARY)

    if data.get("type") == "FeatureCollection":
        geoms = [shape(feature["geometry"]) for feature in data.get("features", [])]
    elif data.get("type") == "Feature":
        geoms = [shape(data["geometry"])]
    else:
        geoms = [shape(data)]

    if not geoms:
        raise ValueError("GeoJSON内にジオメトリが見つかりません。")

    boundary = unary_union(geoms)

    if boundary.is_empty:
        raise ValueError("境界ポリゴンが空です。")

    return boundary


def main() -> None:
    print("=== 各務原市 1kmグリッド生成を開始します ===")

    boundary_lonlat = load_boundary_geometry()

    transformer_to_6675 = Transformer.from_crs(
        SOURCE_CRS,
        TARGET_CRS_6675_CUSTOM,
        always_xy=True,
    )

    transformer_to_web = Transformer.from_crs(
        TARGET_CRS_6675_CUSTOM,
        WEB_CRS,
        always_xy=True,
    )

    boundary_6675 = transform(transformer_to_6675.transform, boundary_lonlat)

    # 境界の6675版を出力
    write_geojson(
        OUT_BOUNDARY_6675,
        [
            make_feature(
                boundary_6675,
                {
                    "city_name": "岐阜県各務原市",
                    "created_at": datetime.now().isoformat(timespec="seconds"),
                    "crs_note": "JGD2011 / Japan Plane Rectangular CS VII custom",
                },
            )
        ],
        "kakamigahara_boundary_6675_python",
    )

    minx, miny, maxx, maxy = boundary_6675.bounds

    # 1,000m単位に切り下げ・切り上げして、きれいなグリッドにする
    start_x = math.floor(minx / GRID_SIZE_M) * GRID_SIZE_M
    end_x = math.ceil(maxx / GRID_SIZE_M) * GRID_SIZE_M
    start_y = math.floor(miny / GRID_SIZE_M) * GRID_SIZE_M
    end_y = math.ceil(maxy / GRID_SIZE_M) * GRID_SIZE_M

    all_cells = []
    y = start_y
    while y < end_y:
        x = start_x
        while x < end_x:
            cell = box(x, y, x + GRID_SIZE_M, y + GRID_SIZE_M)
            all_cells.append(cell)
            x += GRID_SIZE_M
        y += GRID_SIZE_M

    print(f"作成した全グリッド数: {len(all_cells)}")

    # 各務原市に少しでもかかるグリッドだけ抽出
    selected_cells = []
    for cell in all_cells:
        if cell.intersects(boundary_6675):
            selected_cells.append(cell)

    # 北から南、西から東の順に並べる
    selected_cells.sort(key=lambda g: (-g.bounds[3], g.bounds[0]))

    print(f"各務原市にかかるグリッド数: {len(selected_cells)}")

    # 全グリッドの6675出力
    all_features_6675 = []
    for i, cell in enumerate(all_cells, start=1):
        all_features_6675.append(
            make_feature(
                cell,
                {
                    "tmp_id": i,
                    "grid_size_m": GRID_SIZE_M,
                },
            )
        )

    write_geojson(
        OUT_GRID_ALL_6675,
        all_features_6675,
        "kakamigahara_grid_all_6675_python",
    )

    # 抽出済みグリッドの6675版とWeb版を作る
    selected_features_6675 = []
    selected_features_web = []

    for idx, cell in enumerate(selected_cells, start=1):
        grid_id = f"G-{idx:03d}"

        intersection_area = cell.intersection(boundary_6675).area
        coverage_ratio = intersection_area / (GRID_SIZE_M * GRID_SIZE_M)

        centroid_web = transform(transformer_to_web.transform, cell.centroid)
        cell_web = transform(transformer_to_web.transform, cell)

        minx_cell, miny_cell, maxx_cell, maxy_cell = cell.bounds

        props = {
            "grid_id": grid_id,
            "grid_size_m": GRID_SIZE_M,
            "x_min_m": round(minx_cell, 3),
            "y_min_m": round(miny_cell, 3),
            "x_max_m": round(maxx_cell, 3),
            "y_max_m": round(maxy_cell, 3),
            "centroid_lng": round(centroid_web.x, 8),
            "centroid_lat": round(centroid_web.y, 8),
            "intersect_area_m2": round(intersection_area, 2),
            "coverage_ratio": round(coverage_ratio, 4),
        }

        selected_features_6675.append(make_feature(cell, props))
        selected_features_web.append(make_feature(cell_web, props))

    write_geojson(
        OUT_GRID_6675,
        selected_features_6675,
        "kakamigahara_grid_6675_python",
    )

    write_geojson(
        OUT_GRID_WEB,
        selected_features_web,
        "kakamigahara_grid",
    )

    summary = [
        "各務原市 1kmグリッド生成結果",
        "==============================",
        f"作成日時: {datetime.now().isoformat(timespec='seconds')}",
        f"入力ファイル: {INPUT_BOUNDARY}",
        f"全グリッド数: {len(all_cells)}",
        f"各務原市にかかるグリッド数: {len(selected_cells)}",
        f"グリッドサイズ: {GRID_SIZE_M}m x {GRID_SIZE_M}m",
        "",
        "出力ファイル:",
        f"- {OUT_BOUNDARY_6675.name}",
        f"- {OUT_GRID_ALL_6675.name}",
        f"- {OUT_GRID_6675.name}",
        f"- {OUT_GRID_WEB.name}",
        "",
        "備考:",
        "grid_id は北から南、西から東の順に G-001 から付番しています。",
        "kakamigahara_grid.geojson はWeb地図表示用のEPSG:4326相当です。",
    ]

    OUT_SUMMARY.write_text("\n".join(summary), encoding="utf-8")
    print(f"出力しました: {OUT_SUMMARY}")

    print("=== 完了 ===")


if __name__ == "__main__":
    main()